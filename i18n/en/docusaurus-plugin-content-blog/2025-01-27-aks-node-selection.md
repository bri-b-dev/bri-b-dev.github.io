---
slug: aks-node-selection
title: "AKS Node Selection: Physical Pools vs. Virtual Nodes"
authors: brigitte
tags: [kubernetes, aks, azure, nodepool, virtual-node, scheduling]
date: 2025-01-27
description: "Strategies for running workloads in AKS preferentially on physical user nodes – with automatic fallback to virtual nodes."
---

import Admonition from '@theme/Admonition';

In many projects, the **cost and resource model** is crucial:
- Physical AKS node pools (`user nodes`) are cheaper and optimized for continuous workloads.  
- **Virtual nodes** (based on Azure Container Instances) are ideal for **burst scenarios**—when more capacity is needed at short notice.  
<!--truncate-->
👉 Goal: Workloads should **always use the physical nodes first**, but automatically switch to virtual nodes when there are no more resources available there.

---

## ⚙️ Basics: Node pools in AKS
- **System Pool**: internal AKS services
- **User Pool**: physical VM-based nodes (e.g., VMSS with Standard_D4s_v5)
- **Virtual Node Pool**: based on ACI, highly scalable, pay-per-use, no VM instance costs

---

## 🚧 Challenge
By default, Kubernetes distributes pods evenly – without “preference."  
If you want to use virtual nodes **only as a stopgap measure**, you need a clean scheduling strategy.

---

## ✅ Strategies for Node Selection

### 1. NodeSelector + Taints/Tolerations
- User nodes: no special taints → pods run here by default.  
- Virtual nodes: tainted (`virtual-kubelet.io/provider=azure:NoSchedule`).  
- Only pods that set **tolerations** are allowed to fall back to virtual nodes.

```yaml
tolerations:
  - key: “virtual-kubelet.io/provider"
    operator: “Equal"
    value: “azure"
    effect: “NoSchedule"
````

➡️ Advantage: full control, default = user nodes, virtual nodes = fallback.

---

2. Affinity & Preferred Scheduling

`nodeAffinity` can be used to express a **preference**:

* “Prefer user nodes" (preferred)
* “Allow virtual nodes" (soft)

```yaml
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        preference:
          matchExpressions:
            - key: kubernetes.azure.com/mode
              operator: In
              values:
                - user
```

👉 Only when there is no more space there will pods be distributed to other nodes (including virtual nodes).

---

### 3. Workload-specific control

* **Batch/burst jobs**: Set `tolerations` so that they can use virtual nodes.
* **Persistent services**: No taint/toleration → remain strictly on physical nodes.

---

## 📊 Visualization: Scheduling Strategy

```mermaid
flowchart TD
    subgraph AKS[“AKS Cluster"]
        subgraph UserPool[“User Node Pool (VMs)"]
            U1[“User Node 1"]
            U2[“User Node 2"]
            U3[“User Node 3"]
        end

        subgraph VirtualPool[“Virtual Node Pool (ACI)"]
            V1[“Virtual Node"]
        end

        P1[“Pod A (Deployment)"]
        P2[“Pod B (Job)"]
    end

    P1 -->|preferred| U1 & U2 & U3
    P1 -.->|fallback| V1

    P2 -->|toleration| V1
```

* **Pod A (Deployment)**: prefers user nodes, but falls back to virtual nodes when resources are scarce.
* **Pod B (Job)**: has explicit tolerance → may run directly on virtual nodes.

---

## 📌 Best Practices

* **Monitoring**: Track exactly how many pods are running on virtual nodes (cost control).
* **SLA**: Virtual nodes have different limits (no DaemonSet support, limited features).
* **Workload design**: Short jobs and burst-like loads → virtual nodes; critical systems → user nodes.
* **Cost model**: Physical pools for base load, Virtual Nodes only for peaks.

<Admonition type="tip" title="Avoid cost traps">
Set limits and autoscaling correctly, otherwise too many pods will end up permanently on expensive Virtual Nodes!
</Admonition>

---

## 📌 Conclusion

With **Affinity, Taints & Tolerations**, two-stage scheduling can be implemented:

* Permanent workloads run reliably and cost-effectively on physical user nodes.
* Peak loads are automatically directed to virtual nodes – flexibly, scalably, and without overprovisioning.

---

## 📦 Example manifests (deployment & batch job)

> Assumptions:
>
> * **User nodes** carry the label: `kubernetes.azure.com/mode=user`
> * **Virtual nodes** are tainted with `virtual-kubelet.io/provider=azure:NoSchedule`
> * Cluster has at least one Linux virtual node (ACI)

### 1) Deployment: prefers user nodes, fallback to virtual node

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-frontend
  labels:
    app: web-frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-frontend
  template:
    metadata:
      labels:
        app: web-frontend
    spec:
      # ❶ Prefer physical user nodes
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions:
                  - key: kubernetes.azure.com/mode
                    operator: In
                    values: ["user"]
      # ❷ Allow fallback to virtual nodes (tolerate taint)
      tolerations:
        - key: "virtual-kubelet.io/provider"
          operator: "Equal"
          value: "azure"
          effect: "NoSchedule"
      # ❸ Optional: Distribute pods across user nodes (cost & resilience)
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: web-frontend
      containers:
        - name: app
          image: ghcr.io/example/web:1.2.3
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
```

> Result: As long as resources are available on user nodes, all replicas are placed there. Only when resources are scarce can pods also be scheduled on virtual nodes thanks to **tolerance**.

---

### 2) BatchJob: prefers virtual nodes to conserve user pool

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: image-transcode
spec:
  completions: 5
  parallelism: 5
  backoffLimit: 0
  template:
    spec:
      # ❶ Prefer Virtual Node (soft), but allow users as backup
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions:
                  - key: kubernetes.io/role
                    operator: In
                    values: ["virtual-node"]
      # ❷ Tolerance for the virtual node taint (required for scheduling)
      tolerations:
        - key: "virtual-kubelet.io/provider"
          operator: "Equal"
          value: "azure"
          effect: "NoSchedule"
      restartPolicy: Never
      containers:
        - name: worker
          image: ghcr.io/example/transcoder:2.0.0
          args: ["--input", "$(INPUT)", "--output", "$(OUTPUT)"]
          env:
            - name: INPUT
              value: "/data/in"
            - name: OUTPUT
              value: "/data/out"
          resources:
            requests:
              cpu: "1"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "2Gi"
```

> Note: The key `kubernetes.io/role=virtual-node` is **an example label**. In many clusters, a suitable label already exists on virtual nodes (e.g., `type=virtual-kubelet` or `kubernetes.azure.com/virtual-node=true`). Adjust the **match expression** to your actual node labels.

---

### 3) Variant: Strict separation via NodeSelector

If certain workloads should **never** run on virtual nodes, use a hard `nodeSelector` on user nodes **without** tolerations:

```yaml
spec:
  template:
    spec:
      nodeSelector:
        kubernetes.azure.com/mode: “user"
      # No toleration → no scheduling on virtual nodes possible
```

And vice versa (virtual node only):

```yaml
spec:
  template:
    spec:
      tolerations:
        - key: "virtual-kubelet.io/provider"
          operator: "Equal"
          value: "azure"
          effect: "NoSchedule"
      nodeSelector:
        kubernetes.azure.com/virtual-node: "true" # Sample label, customize it for your needs
```

---

### 4) Horizontal Pod Autoscaler (HPA) as a burst trigger

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-frontend
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-frontend
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```