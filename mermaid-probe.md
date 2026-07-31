# Mermaid capability probe

Throwaway. Answers two questions GitHub does not document: which Mermaid version it
runs, and whether the beta treemap type renders here.

## Version

```mermaid
info
```

## Treemap, beta keyword

```mermaid
treemap-beta
"Coverage"
    "internal/tariff": 144
    "cmd/gateway": 88
    "internal/basket": 61
```

## Treemap, plain keyword

```mermaid
treemap
"Coverage"
    "internal/tariff": 144
    "cmd/gateway": 88
```

## Treemap with per-node colour

```mermaid
treemap-beta
"Coverage"
    "internal/tariff": 144
    "cmd/gateway": 88
classDef good fill:#1a9850,stroke:#161b22
classDef bad fill:#d73027,stroke:#161b22
"internal/tariff":::good
"cmd/gateway":::bad
```

## Pie, as a control that definitely works

```mermaid
pie title Control
    "covered" : 76.8
    "uncovered" : 23.2
```
