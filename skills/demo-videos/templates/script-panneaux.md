---
video: mon-slug
titre: Titre de la vidéo
cible: ~2 min
fournisseur: muet
habillage: panneaux
environnement: https://koumoul.com/data-fair — département Test et développement
carton_eyebrow: Événement — Nom de l'événement
carton_sous_titre: Data Fair — démonstration en boucle
carton_site: datafair.cloud
---

# Titre de la vidéo

Boucle sans sous-titres : la citation d'un beat devient un **panneau** pleine
page inséré au montage avant son fragment ; les beats suivants sans citation
sont des **fragments** du même panneau. Les citations sont des textes de panneau
courts (~100 à 150 caractères), pas des narrations. Le scénario appelle `mark()`
après l'attente de rendu de chaque fragment (fin du chargement).

---

### beat-00 — Carton d'ouverture

> Data Fair, la plateforme open source éditée par Koumoul.

Carton plein écran (affiché par le kit), durée portée par la citation.

### beat-01 — Portail open data

> Catalogue DCAT, API REST documentée, visualisations : sans développement.

Premier fragment : goto du catalogue, attente de rendu, puis `mark()` ; défilement.

### beat-02 — (fragment) Exploration

Sans citation : enchaîne sur le panneau précédent (recherche, filtres).

### beat-03 — Data marketplace

> Permissions fines, SSO, journal d'audit : open data et close data sur une même
> plateforme.

Fragment : page des accès, puis `mark()` et démonstration.

### beat-04 — Carton de fin

> Retrouvez la documentation complète sur datafair.cloud.

Carton de fin (`showOutro`), durée portée par la citation.
