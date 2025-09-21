---
slug: workload-identity-lessons-learned
title: "Workload Identity in AKS – Lessons Learned"
authors: brigitte
tags: [kubernetes, azure, aks, security, identity, lessons-learned]
date: 2024-11-10
description: "Setup, Stolpersteine und Best Practices aus Projekten"
---

import Admonition from '@theme/Admonition';

Workload Identity in **Azure Kubernetes Service (AKS)** verspricht weniger Secrets, native AzureAD-Integration und eine Ablösung der alten AAD Pod Identity.  
In meinen Projekten im Herbst 2024 habe ich damit aber nicht nur reibungslose Deployments, sondern auch einige Stolpersteine erlebt.  
<!-- truncate -->
Hier meine **Erfahrungen aus der Praxis** – gegliedert nach Setup, Stolpersteinen und Best Practices.

---

## ⚙️ Setup

- **Cluster**: AKS mit aktiviertem **Workload Identity Feature**  
- **Operator**: `azure-workload-identity` als Admission Webhook im Cluster  
- **Service Accounts**: Pro Pod ein SA mit Annotationen wie  
  ```yaml
  annotations:
    azure.workload.identity/client-id: <client-id>
  ```

* **Azure-Seite**:

  * Managed Identities für Pods
  * Rollenbindung über AAD & Azure RBAC (Storage, Key Vault, Application Gateway)

---

## 🚧 Stolpersteine

### Sidecar-Injection nicht immer zuverlässig

Die Annotation `azure.workload.identity/inject-proxy-sidecar` funktionierte nicht in allen Operator-Versionen.
In manchen Fällen war ein spezielles Helm-Template oder ein zusätzliches MutatingWebhook-Setup nötig.

### AuthorizationPermissionMismatch

Häufiger Fehler beim Zugriff auf Storage Accounts.
Grund: Verwechslung von **Management Plane**-Rollen mit **Data Plane**-Rollen.
➡️ Erst wenn die *richtigen Data Plane Roles* vergeben sind, klappt der Zugriff.

### Helm-Templates & SecurityContext

Ein fehlerhafter `securityContext` im Helm-Chart verhinderte die Sidecar-Injektion.
Das Debugging kostete viel Zeit – Logs vom Webhook-Pod halfen bei der Aufklärung.

### Operator-Versionen mit Breaking Changes

Minor-Releases des Operators haben das Verhalten geändert.
➡️ Upgrade-Notes lesen, bevor man blind auf die neueste Version setzt.

---

## ✅ Best Practices

* **Klein anfangen**: Erst mit einem einfachen Pod + Storage Account testen.
* **RBAC trennen**: Management vs. Data Roles sauber unterscheiden.
* **Operator-Logs prüfen**: Der Admission Webhook ist die erste Anlaufstelle bei Fehlern.
* **Helm-Templates validieren**: Vor Deploy prüfen, ob Annotationen und Sidecars im Pod landen.
* **Zeit einplanen**: Realistisch für Debugging und Iterationen kalkulieren.

<Admonition type="tip" title="Mein Tipp">
Workload Identity spart langfristig viel Aufwand und erhöht die Sicherheit.  
Aber für die Einführung solltest du **zusätzliche Iterationen** einplanen – besonders bei komplexeren Helm-Charts.
</Admonition>

---

## 📌 Fazit

Workload Identity ist ein **wichtiger Schritt für Security und Cloud-Native-Architekturen**.
Die ersten Projekte waren nicht friktionsfrei, doch inzwischen laufen unsere Plattform-Komponenten stabil und ohne Secrets.
Ein Setup, das sich definitiv lohnt – auch wenn der Weg dahin mehr Debugging erforderte, als die Doku vermuten ließ.

---

*Wie sind deine Erfahrungen? Schreib mir gerne oder connecte dich auf [LinkedIn](https://www.linkedin.com/in/brigitte-boehm-34b7a025/).*

