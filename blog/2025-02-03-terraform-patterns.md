---

slug: terraform-patterns-aks-azure
title: "Terraform Patterns für AKS & Azure"
authors: brigitte
tags: [terraform, aks, azure, rbac, network-policy, modules, cicd]
date: 2025-02-03
description: "Erfahrungen mit modularen Terraform-Setups für AKS – von Modul-Design über RBAC bis zu Network Policies und CI/CD."
---

import Admonition from '@theme/Admonition';

AKS-Projekte wachsen schnell: **Cluster, Node Pools, Identities, Netzwerke, ACR, Policies** – und pro Umgebung (dev/test/prod) variieren Parameter. Ohne Struktur wird die Codebasis fragil. In diesem Beitrag zeige ich **bewährte Terraform-Patterns** für Azure & AKS aus Projekten, inkl. **RBAC**- und **Network-Policy**-Fallstricken.
<!--truncate-->
---

## 🧱 Modul-Architektur: Trennen nach Verantwortlichkeiten

**Ziel:** Wiederverwendbare, klar geschnittene Module statt eines „Monolithen“.

```text
infra/
├─ modules/
│  ├─ network/                 # VNet, Subnets, NSGs, UDR/NAT
│  ├─ aks/                     # AKS-Cluster + Pools
│  ├─ identity/                # UAMI/MI + Role Assignments
│  ├─ acr/                     # Container Registry
│  ├─ monitoring/              # Log Analytics, Insights
│  ├─ policies/                # Azure Policy + AKS Add-Ons
│  └─ dns/                     # Private DNS Zonen
├─ env/
│  ├─ dev/
│  │  ├─ main.tf               # Zusammensetzen der Module
│  │  ├─ variables.tfvars
│  │  └─ backend.tf            # Remote State
│  └─ prod/
│     ├─ ...
└─ global/
   └─ rg.tf                    # Ressourcengruppen, Tags, Management
```

**Pattern:** Environments sind **Kompositionen** aus Modulen. Jedes Modul besitzt eine **klare API** (Inputs/Outputs) und minimale Seiteneffekte.

<Admonition type="tip" title="Keep Inputs simple">
Vermeide riesige, verschachtelte `object`-Variablen. Lieber mehrere flache Inputs mit Defaults – das reduziert `Unknown`-Diffs und erleichtert Upgrades.
</Admonition>

---

## 🔧 Beispiel: AKS-Modul (Interface)

```hcl
variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "kubernetes_version" { type = string }
variable "network_profile" {
  type = object({
    plugin           = string   # azure, kubenet, cni_overlay
    pod_cidr         = optional(string)
    service_cidr     = string
    dns_service_ip   = string
    outbound_type    = string   # loadBalancer, userDefinedRouting, managedNATGateway
  })
}
variable "enable_azure_rbac" { type = bool, default = true }
variable "aad_admin_group_object_ids" { type = list(string), default = [] }
variable "system_node_pool" {
  type = object({
    name       = string
    vm_size    = string
    min_count  = number
    max_count  = number
    os_sku     = optional(string, "Ubuntu")
  })
}
variable "user_node_pools" {
  type = list(object({
    name       = string
    vm_size    = string
    min_count  = number
    max_count  = number
    taints     = optional(list(string), [])
    labels     = optional(map(string), {})
    mode       = optional(string, "User")
  }))
  default = []
}
output "kubelet_identity_principal_id" { value = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id }
output "cluster_id" { value = azurerm_kubernetes_cluster.this.id }
```

> **Hinweis:** Abhängig von Provider-Versionen unterscheiden sich Block‑Namen/Flags. Kapsle Version-Spezifika **im Modul** und biete stabile Inputs nach außen.

---

## 🪪 RBAC & Identitäten: häufige Fallstricke

### 1) Azure RBAC vs. Kubernetes RBAC

* **Azure RBAC für Kubernetes** ("AKS-managed AAD") vereinfacht die AuthN/AuthZ, aber **Mapping & Propagation** dauern ggf. Sekunden/Minuten.
* **Pattern:** Lege **AAD-Gruppen** für Cluster‑Rollen an (z. B. `aks-admins`, `aks-devs`) und reiche deren Objekt‑IDs als Modul‑Input durch.

```hcl
# Pseudocode – Modul nutzt diese IDs
variable "aad_admin_group_object_ids" { type = list(string) }
# Im Cluster‑Block: AAD/RBAC aktivieren und Gruppen als Admins registrieren
```

**Anti‑Pattern:** Einzelne User direkt hinterlegen → schwer wartbar, keine Rotation.

### 2) Kubelet/ACR Berechtigungen

* Damit Nodes Images ziehen können: `AcrPull` auf **ACR** für die **Kubelet-Identity**.
* Zusätzlich: Build/Push‑Pipeline → `AcrPush` für CI‑Service‑Principal oder UAMI.

```hcl
resource "azurerm_role_assignment" "kubelet_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = module.aks.kubelet_identity_principal_id
}
```

### 3) Netzwerk‑Rollen

* Bei **UDR/NAT Gateway**: `Network Contributor` auf Subnet/RouteTable für die **AKS‑MI** (Cluster Identity) – sonst schlägt Provisioning/Scale fehl.

<Admonition type="caution" title="Eventual Consistency">
Role Assignments sind **eventual consistent**. Plane Wartezeiten/`depends_on` ein oder nutze ein Retry‑Wrapper‑Modul.
</Admonition>

---

## 🔐 Network Policies: Praxis statt Theorie

**Ziel:** Default‑Deny auf Pod‑Ebene + gezielte Allow‑Regeln.

* **CNI/Policy-Matrix** unterscheidet sich je nach AKS‑Version: Azure CNI (Classic/Overlay) & Kubenet verhalten sich unterschiedlich.
* **Pattern:** Parametrisiere Policy‑Engine (`azure`, `calico`) als Modul‑Input und generiere **Basisregeln** zentral.

### Baseline (Namespaceseitig) – Default Deny

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: myns
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

### Allow: Ingress vom Ingress-Controller + DNS Egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-from-gateway
  namespace: myns
spec:
  podSelector:
    matchLabels:
      app: web
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
```

<Admonition type="note" title="Test">
Validiere Policies mit `netshoot`, `curl`, `dig` und CI‑Checks (z. B. Kyverno/OPA‑Constraints). Automatisierte Smoke‑Tests sind Gold wert.
</Admonition>

---

## 🌐 Netzwerk-Setup: bewährte Optionen

* **Outbound**: `managedNATGateway` oder `userDefinedRouting` mit Azure Firewall.
* **Private Cluster**: Private Endpoint + DNS Zonen, Jump‑Host/Bastion für `kubectl`.
* **Ingress**: AGIC oder NGINX; bei Private Cluster → interne LoadBalancer/Private Link.
* **Egress‑Lockdown**: Azure Firewall DNAT/Anwendungsregeln; Policies für verbotene Public‑IPs.

**Pattern:** Netz‑Modul liefert **Subnet‑IDs**/Routen als Outputs an das AKS‑Modul; keine zirkulären Abhängigkeiten.

---

## 🧪 Environments, Workspaces & State

* **Remote State** in Azure Storage (Blob) mit **State‑Locking** via Storage Lease.
* **One workspace per environment** (z. B. `dev`, `prod`) – kein Mischen.
* **tfvars** pro Umgebung + `locals` für abgeleitete Werte (Tags, Namenskonventionen, CIDRs).

```hcl
# backend.tf (je Env)
terraform {
  backend "azurerm" {}
  required_version = ">= 1.7.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }
}
```

<Admonition type="tip" title="Namenskonventionen">
Ein `locals.naming`‑Block vereinheitlicht Ressourcennamen über alle Module (Prefix/Env/Location).
</Admonition>

---

## 🚦 CI/CD & Sicherheit

* **Pipeline‑Matrix** pro Umfeld (Plan/Apply) mit manueller Freigabe für prod.
* **Pre‑Commit**: `terraform fmt`, `tflint`, `tfsec`/`checkov`, `terrascan`.
* **Drift Detection**: `terraform plan` on schedule → Slack/Teams‑Report.
* **Plan‑Artefakte** signieren/archivieren.
* **Provider‑Pins** + Renovate/Bump PRs → reproduzierbare Builds.

**Pattern:** `make plan ENV=dev` ruft `terraform workspace select dev` + `-var-file=env/dev/variables.tfvars` auf – identische Befehle lokal und in CI.

---

## 📦 Komplettes AKS-Beispiel (gekürzt)

```hcl
module "network" {
  source              = "../modules/network"
  name                = local.naming.net
  location            = var.location
  address_space       = ["10.40.0.0/16"]
  subnets = {
    aks_nodes = {
      prefix = "10.40.1.0/24"
      nsg_rules = ["deny_internet_in", "allow_vnet"]
    }
  }
}

module "acr" {
  source              = "../modules/acr"
  name                = local.naming.acr
  location            = var.location
  sku                 = "Standard"
}

module "aks" {
  source                  = "../modules/aks"
  name                    = local.naming.aks
  location                = var.location
  resource_group_name     = azurerm_resource_group.rg.name
  kubernetes_version      = var.k8s_version
  network_profile = {
    plugin         = "azure"
    service_cidr   = "10.41.0.0/16"
    dns_service_ip = "10.41.0.10"
    outbound_type  = "managedNATGateway"
  }
  system_node_pool = {
    name      = "sys"
    vm_size   = "Standard_D4s_v5"
    min_count = 1
    max_count = 3
  }
  user_node_pools = [
    {
      name = "user"
      vm_size = "Standard_D8s_v5"
      min_count = 2
      max_count = 10
      labels = { "kubernetes.azure.com/mode" = "user" }
    }
  ]
  enable_azure_rbac            = true
  aad_admin_group_object_ids   = var.aad_admin_groups
}

# Role Assignment für Kubelet → ACR Pull
resource "azurerm_role_assignment" "kubelet_acr" {
  scope                = module.acr.id
  role_definition_name = "AcrPull"
  principal_id         = module.aks.kubelet_identity_principal_id
}
```

---

## 🧭 Checkliste – Was gerne schiefgeht

* [ ] `AcrPull` für **Kubelet** vergessen → ImagePullBackOff
* [ ] Subnet/RT/NAT Rechte fehlen → AKS Provisioning hängt
* [ ] Azure RBAC Gruppen nicht propagiert → Admins können nicht joinen (abwarten/retry)
* [ ] Network Policies greifen nicht (Policy‑Engine/CNI passt nicht zur Cluster‑Config)
* [ ] Private DNS nicht konfiguriert → Control Plane/Ingress/ACR nicht erreichbar
* [ ] Provider‑Upgrade ohne Modul‑Kapselung → Breaking Changes überall

<Admonition type="caution" title="Production Readiness">
Vor Prod‑Rollout: e2e‑Tests (Deployments, Pull aus ACR, Ingress, DNS, Policy‑Smoke), Loadtests, Failover (Node Drain, Pool‑Scaling), Backup/Restore (etcd/Velero), Secrets‑Pfad (Key Vault + CSI).
</Admonition>

---

## 📌 Fazit

Ein **modulares Terraform‑Design** für AKS zahlt sich aus: klarere Zuständigkeiten, weniger Drift, reproduzierbare Builds und kontrollierte Sicherheit. Mit sauberem RBAC, durchdachtem Netzwerk‑Layout und automatisierten Checks bleibt die Plattform **skalierbar** und **betriebsstabil**.

---

## 📦 Vollständiges AKS‑Modul (Beispiel)

**`modules/aks/main.tf`**

```hcl
resource "azurerm_kubernetes_cluster" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = "${var.name}-dns"
  kubernetes_version  = var.kubernetes_version

  identity {
    type = "SystemAssigned"
  }

  default_node_pool {
    name                = var.system_node_pool.name
    vm_size             = var.system_node_pool.vm_size
    min_count           = var.system_node_pool.min_count
    max_count           = var.system_node_pool.max_count
    enable_auto_scaling = true
    os_sku              = var.system_node_pool.os_sku
    mode                = "System"
  }

  dynamic "agent_pool_profile" {
    for_each = var.user_node_pools
    content {
      name                = agent_pool_profile.value.name
      vm_size             = agent_pool_profile.value.vm_size
      min_count           = agent_pool_profile.value.min_count
      max_count           = agent_pool_profile.value.max_count
      enable_auto_scaling = true
      mode                = lookup(agent_pool_profile.value, "mode", "User")
      node_labels         = lookup(agent_pool_profile.value, "labels", null)
      node_taints         = lookup(agent_pool_profile.value, "taints", null)
    }
  }

  role_based_access_control_enabled = var.enable_azure_rbac

  azure_active_directory_role_based_access_control {
    managed                = true
    admin_group_object_ids = var.aad_admin_group_object_ids
  }

  network_profile {
    network_plugin     = var.network_profile.plugin
    service_cidr       = var.network_profile.service_cidr
    dns_service_ip     = var.network_profile.dns_service_ip
    pod_cidr           = try(var.network_profile.pod_cidr, null)
    outbound_type      = var.network_profile.outbound_type
  }
}

output "kubelet_identity_principal_id" {
  value = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

output "id" {
  value = azurerm_kubernetes_cluster.this.id
}
```

**`modules/aks/variables.tf`**

```hcl
variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "kubernetes_version" { type = string }

variable "network_profile" {
  type = object({
    plugin         = string
    service_cidr   = string
    dns_service_ip = string
    pod_cidr       = optional(string)
    outbound_type  = string
  })
}

variable "enable_azure_rbac" { type = bool }
variable "aad_admin_group_object_ids" { type = list(string) }

variable "system_node_pool" {
  type = object({
    name      = string
    vm_size   = string
    min_count = number
    max_count = number
    os_sku    = optional(string, "Ubuntu")
  })
}

variable "user_node_pools" {
  type = list(object({
    name      = string
    vm_size   = string
    min_count = number
    max_count = number
    mode      = optional(string, "User")
    labels    = optional(map(string))
    taints    = optional(list(string))
  }))
  default = []
}
```

---

## 🚀 Azure DevOps Pipeline für Terraform AKS

**`.azure-pipelines/terraform-aks.yml`**

```yaml
trigger:
  branches:
    include:
      - main

variables:
  TF_VERSION: '1.7.5'
  AZURE_SUBSCRIPTION: 'MyServiceConnection'
  ENVIRONMENT: 'dev'

stages:
  - stage: validate
    displayName: "Terraform Validate & Lint"
    jobs:
      - job: lint
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UseTerraform@0
            inputs:
              terraformVersion: $(TF_VERSION)
          - script: |
              terraform fmt -check -recursive
              terraform init -backend=false
              terraform validate
            displayName: "Terraform fmt & validate"
          - script: |
              curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash
              tflint --recursive
            displayName: "Run TFLint"

  - stage: plan
    displayName: "Terraform Plan"
    dependsOn: validate
    jobs:
      - job: plan
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UseTerraform@0
            inputs:
              terraformVersion: $(TF_VERSION)
          - task: TerraformCLI@0
            displayName: "Terraform Init"
            inputs:
              command: 'init'
              backendType: 'azurerm'
              backendServiceArm: $(AZURE_SUBSCRIPTION)
              ensureBackend: true
              workingDirectory: 'infra/env/$(ENVIRONMENT)'
          - task: TerraformCLI@0
            displayName: "Terraform Plan"
            inputs:
              command: 'plan'
              environmentServiceName: $(AZURE_SUBSCRIPTION)
              workingDirectory: 'infra/env/$(ENVIRONMENT)'
              vars: |
                environment=$(ENVIRONMENT)
          - publish: $(System.DefaultWorkingDirectory)/infra/env/$(ENVIRONMENT)/tfplan
            artifact: tfplan

  - stage: apply
    displayName: "Terraform Apply"
    dependsOn: plan
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: apply
        environment: aks-$(ENVIRONMENT)
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: UseTerraform@0
                  inputs:
                    terraformVersion: $(TF_VERSION)
                - download: current
                  artifact: tfplan
                - task: TerraformCLI@0
                  displayName: "Terraform Apply"
                  inputs:
                    command: 'apply'
                    environmentServiceName: $(AZURE_SUBSCRIPTION)
                    workingDirectory: 'infra/env/$(ENVIRONMENT)'
                    commandOptions: "tfplan"
```

---

## 📌 Ergebnis

Mit einem **klar gekapselten AKS-Modul** und einer **CI/CD-Pipeline in Azure DevOps** erhältst du:

* reproduzierbare Cluster-Deployments
* automatisierte Validierung (fmt, validate, lint)
* Plan-Review mit Artefakten
* manuelles oder automatisiertes Apply mit Service Connection
* einfache Erweiterbarkeit (Drift Detection, Security Scans)

---

## 🧩 Produktionsreifes AKS‑Modul (Terraform)

> Struktur (als Beispiel):
>
> ```text
> modules/aks/
> ├─ main.tf
> ├─ variables.tf
> ├─ outputs.tf
> └─ README.md
> ```

**`modules/aks/variables.tf`**

```hcl
variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }

variable "kubernetes_version" { type = string }

variable "tags" { type = map(string), default = {} }

variable "identity_type" {
  description = "system | user"
  type        = string
  default     = "system"
  validation {
    condition     = contains(["system", "user"], var.identity_type)
    error_message = "identity_type must be 'system' or 'user'"
  }
}

variable "user_assigned_identity_ids" {
  description = "Only used when identity_type=user"
  type        = list(string)
  default     = []
}

variable "network_profile" {
  type = object({
    plugin           = string                    # azure | kubenet | cni_overlay
    service_cidr     = string
    dns_service_ip   = string
    pod_cidr         = optional(string)
    outbound_type    = optional(string, "managedNATGateway") # loadBalancer | userDefinedRouting | managedNATGateway
    network_policy   = optional(string, null)   # azure | calico | null
  })
}

variable "private_cluster_enabled" { type = bool, default = false }
variable "api_server_authorized_ip_ranges" { type = list(string), default = [] }

variable "aad_admin_group_object_ids" { type = list(string), default = [] }
variable "enable_azure_rbac" { type = bool, default = true }

variable "oms_workspace_resource_id" { type = string, default = null }
variable "enable_azure_policy_addon" { type = bool, default = false }

variable "system_node_pool" {
  type = object({
    name               = string
    vm_size            = string
    min_count          = number
    max_count          = number
    os_disk_size_gb    = optional(number, 128)
    os_sku             = optional(string, "Ubuntu")
    node_labels        = optional(map(string), {})
    node_taints        = optional(list(string), [])
    zones              = optional(list(string), null)
  })
}

variable "user_node_pools" {
  description = "List of additional user pools"
  type = list(object({
    name               = string
    vm_size            = string
    min_count          = number
    max_count          = number
    os_disk_size_gb    = optional(number, 128)
    os_sku             = optional(string, "Ubuntu")
    node_labels        = optional(map(string), {})
    node_taints        = optional(list(string), [])
    mode               = optional(string, "User")
    zones              = optional(list(string), null)
  }))
  default = []
}
```

**`modules/aks/main.tf`**

```hcl
# Hinweis: Provider-Konfiguration (azurerm) wird außerhalb des Moduls gesetzt.

locals {
  identity_block = var.identity_type == "user" ? {
    type         = "UserAssigned"
    identity_ids = var.user_assigned_identity_ids
  } : {
    type = "SystemAssigned"
  }
}

resource "azurerm_kubernetes_cluster" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  kubernetes_version  = var.kubernetes_version
  dns_prefix          = replace(var.name, ".", "-")

  identity {
    type         = local.identity_block.type
    identity_ids = try(local.identity_block.identity_ids, null)
  }

  default_node_pool {
    name                 = var.system_node_pool.name
    vm_size              = var.system_node_pool.vm_size
    orchestrator_version = var.kubernetes_version
    min_count            = var.system_node_pool.min_count
    max_count            = var.system_node_pool.max_count
    enable_auto_scaling  = true
    os_sku               = var.system_node_pool.os_sku
    os_disk_size_gb      = var.system_node_pool.os_disk_size_gb
    node_labels          = var.system_node_pool.node_labels
    node_taints          = var.system_node_pool.node_taints
    zones                = var.system_node_pool.zones
    upgrade_settings {
      max_surge = "33%"
    }
  }

  network_profile {
    network_plugin    = var.network_profile.plugin
    service_cidr      = var.network_profile.service_cidr
    dns_service_ip    = var.network_profile.dns_service_ip
    network_policy    = var.network_profile.network_policy
    outbound_type     = var.network_profile.outbound_type
    pod_cidr          = try(var.network_profile.pod_cidr, null)
  }

  api_server_access_profile {
    authorized_ip_ranges = var.api_server_authorized_ip_ranges
  }

  azure_active_directory_role_based_access_control {
    enabled                        = true
    azure_rbac_enabled             = var.enable_azure_rbac
    admin_group_object_ids         = var.aad_admin_group_object_ids
  }

  # Add-ons
  dynamic "oms_agent" {
    for_each = var.oms_workspace_resource_id == null ? [] : [1]
    content {
      log_analytics_workspace_id = var.oms_workspace_resource_id
    }
  }

  azure_policy_enabled        = var.enable_azure_policy_addon
  private_cluster_enabled     = var.private_cluster_enabled

  sku_tier = "Paid" # Uptime SLA optional, anpassbar

  tags = var.tags
}

# Zusätzliche User Node Pools
resource "azurerm_kubernetes_cluster_node_pool" "user" {
  for_each = { for p in var.user_node_pools : p.name => p }

  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  name                  = each.value.name
  vm_size               = each.value.vm_size
  orchestrator_version  = var.kubernetes_version
  mode                  = try(each.value.mode, "User")
  min_count             = each.value.min_count
  max_count             = each.value.max_count
  enable_auto_scaling   = true
  os_disk_size_gb       = try(each.value.os_disk_size_gb, 128)
  os_sku                = try(each.value.os_sku, "Ubuntu")
  node_labels           = try(each.value.node_labels, {})
  node_taints           = try(each.value.node_taints, [])
  zones                 = try(each.value.zones, null)

  tags = var.tags
}
```

**`modules/aks/outputs.tf`**

```hcl
output "id" { value = azurerm_kubernetes_cluster.this.id }
output "kubelet_identity_principal_id" {
  value = try(azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id, null)
}
output "principal_id" { # Cluster (control plane) MI bei SystemAssigned
  value = try(azurerm_kubernetes_cluster.this.identity[0].principal_id, null)
}
output "host" { value = azurerm_kubernetes_cluster.this.kube_config[0].host }
output "name" { value = azurerm_kubernetes_cluster.this.name }
```

**`modules/aks/README.md`** (Kurz)

```md
Inputs kapseln AKS-Details (RBAC, Network, Private Cluster). Provider außerhalb konfigurieren. Role Assignments (ACR Pull, Subnet/RouteTable) außerhalb setzen.
```

---

## 🔁 Azure DevOps Pipeline (Terraform Plan/Apply, Multi‑Env)

> Voraussetzungen
>
> * Azure DevOps **Service Connection** (ARM) mit **Workload Identity/Federated Credentials** für Subscription/Resource Group.
> * Azure Storage Backend für Terraform State (Container + Blob Locking via Lease).
> * Optional: Variable Groups für `ARM_*`/Backend‑Parameter.

**`azure-pipelines.yml`**

```yaml
trigger:
  branches:
    include: [ main ]
pr:
  branches:
    include: [ main, feature/* ]

variables:
  TF_VERSION: '1.8.5'
  PROVIDER_AZURERM: '~> 3.113'
  # Backend (per Variable Group setzbar)
  TF_BACKEND_RG: 'rg-tfstate'
  TF_BACKEND_SA: 'sttfstate1234'
  TF_BACKEND_CONTAINER: 'tfstate'
  TF_BACKEND_KEY: '$(Build.Repository.Name).$(System.StageName).tfstate'

stages:
- stage: Validate
  displayName: "Validate & Security Checks"
  jobs:
  - job: validate
    pool: { vmImage: 'ubuntu-latest' }
    steps:
    - checkout: self
    - task: Bash@3
      displayName: "Install Terraform $(TF_VERSION)"
      inputs:
        targetType: 'inline'
        script: |
          curl -sLo tf.zip https://releases.hashicorp.com/terraform/$(TF_VERSION)/terraform_$(TF_VERSION)_linux_amd64.zip
          sudo unzip -o tf.zip -d /usr/local/bin
          terraform -version
    - task: Bash@3
      displayName: "Terraform fmt & init"
      env:
        ARM_USE_OIDC: true
      inputs:
        targetType: 'inline'
        script: |
          cd infra/env/dev
          terraform init \
            -backend-config="resource_group_name=$(TF_BACKEND_RG)" \
            -backend-config="storage_account_name=$(TF_BACKEND_SA)" \
            -backend-config="container_name=$(TF_BACKEND_CONTAINER)" \
            -backend-config="key=$(TF_BACKEND_KEY)"
          terraform fmt -check -recursive
          terraform validate
    - task: Bash@3
      displayName: "tflint / tfsec"
      inputs:
        targetType: 'inline'
        script: |
          curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash
          tflint --version
          tflint -f compact || true
          curl -sL https://raw.githubusercontent.com/aquasecurity/tfsec/master/scripts/install_linux.sh | bash
          tfsec . || true

- stage: Plan
  displayName: "Plan (Dev)"
  dependsOn: Validate
  jobs:
  - job: plan_dev
    displayName: "terraform plan dev"
    pool: { vmImage: 'ubuntu-latest' }
    steps:
    - checkout: self
    - task: AzureCLI@2
      displayName: "Terraform init+plan (OIDC)"
      inputs:
        azureSubscription: 'AZURE-SP-WI'   # Name eurer Service Connection
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: |
          set -e
          cd infra/env/dev
          terraform init \
            -backend-config="resource_group_name=$(TF_BACKEND_RG)" \
            -backend-config="storage_account_name=$(TF_BACKEND_SA)" \
            -backend-config="container_name=$(TF_BACKEND_CONTAINER)" \
            -backend-config="key=$(TF_BACKEND_KEY)"
          terraform workspace select dev || terraform workspace new dev
          terraform plan -var-file=variables.tfvars -out=tfplan
    - publish: infra/env/dev/tfplan
      displayName: "Publish plan artifact"
      artifact: tfplan-dev

- stage: Apply
  displayName: "Apply (Dev)"
  dependsOn: Plan
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - deployment: apply_dev
    displayName: "terraform apply dev"
    environment: dev # optional: Environments mit Approvals schützen
    strategy:
      runOnce:
        deploy:
          steps:
          - checkout: self
          - task: AzureCLI@2
            displayName: "Terraform init+apply"
            inputs:
              azureSubscription: 'AZURE-SP-WI'
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                set -e
                cd infra/env/dev
                terraform init \
                  -backend-config="resource_group_name=$(TF_BACKEND_RG)" \
                  -backend-config="storage_account_name=$(TF_BACKEND_SA)" \
                  -backend-config="container_name=$(TF_BACKEND_CONTAINER)" \
                  -backend-config="key=$(TF_BACKEND_KEY)"
                terraform workspace select dev || terraform workspace new dev
                terraform apply -auto-approve tfplan

- stage: Plan_Prod
  displayName: "Plan (Prod)"
  dependsOn: Apply
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - job: plan_prod
    pool: { vmImage: 'ubuntu-latest' }
    steps:
    - checkout: self
    - task: AzureCLI@2
      displayName: "Plan prod"
      inputs:
        azureSubscription: 'AZURE-SP-WI'
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: |
          set -e
          cd infra/env/prod
          terraform init \
            -backend-config="resource_group_name=$(TF_BACKEND_RG)" \
            -backend-config="storage_account_name=$(TF_BACKEND_SA)" \
            -backend-config="container_name=$(TF_BACKEND_CONTAINER)" \
            -backend-config="key=$(TF_BACKEND_KEY)"
          terraform workspace select prod || terraform workspace new prod
          terraform plan -var-file=variables.tfvars -out=tfplan
    - publish: infra/env/prod/tfplan
      artifact: tfplan-prod

- stage: Apply_Prod
  displayName: "Apply (Prod)"
  dependsOn: Plan_Prod
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - deployment: apply_prod
    displayName: "terraform apply prod"
    environment: prod # Enforce manual approval in ADO Environment
    strategy:
      runOnce:
        deploy:
          steps:
          - checkout: self
          - task: AzureCLI@2
            displayName: "Apply prod"
            inputs:
              azureSubscription: 'AZURE-SP-WI'
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                set -e
                cd infra/env/prod
                terraform init \
                  -backend-config="resource_group_name=$(TF_BACKEND_RG)" \
                  -backend-config="storage_account_name=$(TF_BACKEND_SA)" \
                  -backend-config="container_name=$(TF_BACKEND_CONTAINER)" \
                  -backend-config="key=$(TF_BACKEND_KEY)"
                terraform workspace select prod || terraform workspace new prod
                terraform apply -auto-approve tfplan
```

### Hinweise & Best Practices

* **OIDC/Federated Credentials:** Service Connection so konfigurieren, dass kein Secret nötig ist (kein Service Principal Passwort im Repo).
* **State pro Stage:** Der Key `$(System.StageName)` im Backend trennt dev/prod sauber.
* **Security Scans:** `tflint`/`tfsec` sind `|| true`, damit Warnungen den Build nicht hart brechen – in Prod optional erzwingen.
* **Approvals:** Azure DevOps **Environments** für manuelle Freigaben zwischen Stufen nutzen.
* **Parallel Envs:** Für mehrere Envs `strategy: matrix` in Plan/Apply nutzen oder Envs als separate Stages definieren.

---

## 🔗 Beispiel: Verwendung des AKS‑Moduls in `infra/env/dev/main.tf`

```hcl
terraform {
  required_version = ">= 1.8.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.113"
    }
  }
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  use_oidc = true
}

locals {
  tags = {
    env   = "dev"
    owner = "platform"
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "rg-aks-dev"
  location = var.location
  tags     = local.tags
}

module "aks" {
  source              = "../../modules/aks"
  name                = "aks-dev-core"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  kubernetes_version  = var.k8s_version
  tags                = local.tags

  identity_type = "system"

  network_profile = {
    plugin         = "azure"
    service_cidr   = "10.50.0.0/16"
    dns_service_ip = "10.50.0.10"
    outbound_type  = "managedNATGateway"
    network_policy = "azure"
  }

  aad_admin_group_object_ids = var.aad_admin_groups
  enable_azure_rbac          = true

  private_cluster_enabled           = false
  api_server_authorized_ip_ranges   = []

  system_node_pool = {
    name      = "sys"
    vm_size   = "Standard_D4s_v5"
    min_count = 1
    max_count = 2
    node_labels = {
      "kubernetes.azure.com/mode" = "system"
    }
  }

  user_node_pools = [
    {
      name      = "user"
      vm_size   = "Standard_D8s_v5"
      min_count = 2
      max_count = 6
      node_labels = {
        "kubernetes.azure.com/mode" = "user"
      }
    }
  ]
}

# Beispiel: ACR + Role Assignment (außerhalb des Moduls)
resource "azurerm_container_registry" "acr" {
  name                = "acrdevexample1234"
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location
  sku                 = "Standard"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_role_assignment" "kubelet_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = module.aks.kubelet_identity_principal_id
}
```
