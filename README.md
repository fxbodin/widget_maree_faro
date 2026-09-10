# Widget marées — Faro-Olhão

Page HTML autonome affichant graphiquement l'horaire des marées de Faro-Olhão (Portugal), avec sélecteur de date et ligne "agora" (heure locale) quand la date affichée est le jour courant.

## Fichiers

- `index.html` — page autonome, pas de dépendance de build, ouvrir directement ou servir statiquement.
- `ubersicht-widget.jsx` — widget de bureau pour [Übersicht](http://tracesof.net/uebersicht/) (`brew install --cask ubersicht`). Copier dans `~/Library/Application Support/Übersicht/widgets/maree-faro.widget/index.jsx`. Contourne le CORS en récupérant les données via `curl` (process shell, pas de fetch navigateur) plutôt que via le proxy `r.jina.ai` utilisé par la page HTML.

## Source des données

API publique de l'Instituto Hidrográfico (marine portugaise) :

```
https://www.hidrografico.pt/hmapi/tidestation/?portID={PORTID}&startDate={YYYY-MM-DD}&period={N}
```

- `portID=19` → Faro-Olhão (Barra de Faro-Olhão)
- `startDate` → date de début, format `YYYY-MM-DD`
- `period` → nombre de jours (1 dans ce widget)

Réponse JSON, un item par événement de marée (Preia-Mar / Baixa-Mar), plus quelques items phase lunaire (`height: null`) à ignorer.

## Problème CORS

L'API ne renvoie pas d'en-tête `Access-Control-Allow-Origin`. Ouvrir l'URL directement dans un navigateur fonctionne (simple navigation, pas de contrôle CORS), mais un `fetch()` JS depuis un autre domaine échoue (`Failed to fetch`).

Contournement dans `index.html` : tentative de fetch direct d'abord, puis repli sur le proxy `r.jina.ai` (lecteur web sans clé API) qui relaie la réponse. Voir fonction `fetchTides()`.

Point fragile : dépendance à un service tiers gratuit hors de notre contrôle. Si `r.jina.ai` change de comportement ou tombe, le widget échoue. Alternative plus pérenne : héberger un petit relai serveur soi-même (hors scope de cette page autonome).

## Widget Übersicht — pièges rencontrés

- **`command` en fonction de state = piégé.** Sur la version installée (1.6.82), simplement exporter `initialState`/`updateState` casse silencieusement le pipeline `command` (string) → `output` : `output` reste vide en permanence, sans erreur visible, même si `render()` n'utilise jamais `dispatch`. La doc générique d'Übersicht dit que les deux mécanismes cohabitent ; pas vérifié sur cette version. Solution retenue : navigation de jour gérée entièrement côté client (DOM + `localStorage`), sans passer par `initialState`/`updateState`/`dispatch`.
- **Ne jamais nommer une variable locale `html`.** Le pragma JSX injecté par Übersicht s'appelle `html` (équivalent de `React.createElement`). Une `const html = ...` dans `render()` le masque → `TypeError: html is not a function` sur le premier JSX rencontré après.
- **`${...}` dans un template JS backtick interpole toujours en JS, jamais en shell.** Pour une variable shell dans une commande multi-lignes, utiliser `$VAR` (sans accolades), pas `${VAR}` — sinon `ReferenceError` si aucune variable JS de ce nom n'existe.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou servir via un serveur statique quelconque :

```bash
python3 -m http.server 8000
```

puis `http://localhost:8000/index.html`.
