---
slug: workload-identity-lessons-learned
title: "Workload Identity in AKS – Lessons Learned"
authors: brigitte
tags: [kubernetes, azure, aks, security, identity, lessons-learned]
date: 2024-11-10
description: "Setup, pitfalls, and best practices from real projects"
---

import Admonition from '@theme/Admonition';

Workload Identity in **Azure Kubernetes Service (AKS)** promises fewer secrets, native AzureAD integration, and a replacement for the old AAD Pod Identity.  
In practice, my projects in late 2024 brought not only smooth deployments but also some unexpected pitfalls.  
Here are my **hands-on experiences** – structured into Setup, Pitfalls, and Best Practices.

---

## ⚙️ Setup

- **Cluster**: AKS with **Workload Identity feature** enabled  
- **Operator**: `azure-workload-identity` Admission Webhook in the cluster  
- **Service Accounts**: per pod with annotations like  
  ```yaml
  annotations:
    azure.workload.identity/client-id: <client-id>
  ```

* **Azure side**:

  * Managed Identities for pods
  * Role assignments via AAD & Azure RBAC (Storage, Key Vault, Application Gateway)

---

## 🚧 Pitfalls

### Sidecar injection not always reliable

The annotation `azure.workload.identity/inject-proxy-sidecar` didn't consistently work across operator versions.
Sometimes special Helm templates or additional MutatingWebhook config were required.

### AuthorizationPermissionMismatch

A frequent error when accessing Storage Accounts.
Root cause: mixing up **Management Plane** and **Data Plane** roles.
➡️ Only proper Data Plane roles allow access.

### Helm templates & securityContext

An incorrect `securityContext` in the Helm chart blocked sidecar injection.
Debugging this took time – webhook pod logs revealed the root cause.

### Operator versions with breaking changes

Minor operator releases sometimes changed behavior.
➡️ Always check release notes before upgrading.

---

## ✅ Best Practices

* **Start small**: test with a single pod + storage account
* **Separate RBAC**: clearly distinguish management vs. data plane roles
* **Check operator logs**: Admission webhook is the first stop for debugging
* **Validate Helm templates**: ensure annotations and sidecars land in pod manifests
* **Plan time**: expect iterations during rollout

<Admonition type="tip" title="My Tip">
Workload Identity saves effort and increases security in the long run.  
But allow **extra iterations** during introduction – especially with complex Helm charts.
</Admonition>

---

## 📌 Conclusion

Workload Identity is a **key step for security and cloud-native architectures**.
The initial rollout was not frictionless, but today our platform components run stable and secret-free.
It's worth it – even if debugging took more effort than the docs suggested.

---

*Have you faced similar issues with AKS Workload Identity? Feel free to reach out or connect on [LinkedIn](https://www.linkedin.com/in/my-profile/).*

