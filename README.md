# Widget marées — Faro-Olhão

Soumis à la [galerie de widgets Übersicht](https://github.com/felixhageloh/uebersicht-widgets) — `widget.json`, `maree-faro.widget.zip` et `screenshot.png` (516×320) sont les fichiers requis par leur processus de soumission (issue avec l'URL de ce repo, pas de PR directe).

Page HTML autonome affichant graphiquement l'horaire des marées de Faro-Olhão (Portugal), avec sélecteur de date et ligne "agora" (heure locale) quand la date affichée est le jour courant.

## Fichiers

- `index.html` — page autonome, pas de dépendance de build, ouvrir directement ou servir statiquement.
- `ubersicht-widget.jsx` — widget de bureau pour [Übersicht](http://tracesof.net/uebersicht/) (`brew install --cask ubersicht`). Copier dans `~/Library/Application Support/Übersicht/widgets/maree-faro.widget/index.jsx`. Contourne le CORS en récupérant les données via `curl` (process shell, pas de fetch navigateur) plutôt que via le proxy `r.jina.ai` utilisé par la page HTML.

## Version iPhone (PWA) — `web/`

En ligne : https://www.fxbodin.com/nautical-apps/maree-faro/ — dans Safari : Partager → « Sur l'écran d'accueil ». L'icône ouvre l'app en plein écran, sans barre Safari.

- `web/tides.php` — relai same-origin vers l'API (règle le CORS, supprime la dépendance à `r.jina.ai`). Aucun paramètre accepté : pas un proxy ouvert. Même enveloppe JSON que le widget Übersicht (`{status, fetchedAt, error, data}`), même fenêtre -3/+21 jours. Cache disque `web/cache/` sur OVH (6 h) ; source en panne : cache resservi en `stale`, nouvel essai au plus toutes les 15 min.
- `web/index.html`, `app.js`, `app.css` — page mobile en **portugais du Portugal** (utilisateurs majoritairement lusophones ; termes de l'Instituto Hidrográfico : Preia-mar / Baixa-mar) : courbe (même code que le widget), cartes PM/BM, « Baixa-mar daqui a 3 h 46 », navigation par boutons ou balayage.
- **Installation, dans le navigateur** : carte en bas d'écran adaptée à la plateforme. Android/Chrome : bouton « Instalar » natif (`beforeinstallprompt`), sinon menu ⋮. iPhone : gestes Partilhar → « Adicionar ao ecrã principal ». Navigateur interne Facebook/Instagram ou WebView Android : « Abrir no Safari / Chrome ». « Agora não » la réduit en pastille « Instalar » dans l'en-tête (mémorisé en `localStorage`). Rien sur ordinateur. Limite : le navigateur interne de WhatsApp sur iPhone n'est pas détectable (même UA que Safari), d'où la note dans les consignes iPhone.
- **App installée** (`display-mode: standalone` / `navigator.standalone`) : ni carte ni pastille. Le bouton ⓘ ouvre « Informações » : partager le lien (Web Share), consignes iPhone/Android, état des données + « Atualizar », avertissement de navigation. Le bouton retour d'Android ferme la page (`history.pushState`).
- `web/sw.js` — service worker : la coquille de l'app se lance sans réseau. Les données sont gardées par `app.js` dans `localStorage` : hors ligne, l'app affiche les ~3 semaines déjà chargées (« Hors ligne · données du … »). Incrémenter `VERSION` dans `sw.js` si la liste des fichiers change.
- `web/.htaccess` — `DirectoryIndex index.html` (le WordPress parent impose `index.php`), CSP stricte (tout en same-origin), cache Apache `no-cache`, `cache/` en 404.
- « Aujourd'hui » et la ligne « maintenant » sont calculés à l'heure de Lisbonne, pas à celle du téléphone.

Déploiement : `.github/workflows/deploy-ovh.yml`, même schéma que `carte-orques-iberiques` (lftp/SFTP à chaque push sur `web/**`, `--exclude cache/` pour préserver le cache serveur, puis contrôle de `tides.php` en ligne). Secrets du dépôt : `OVH_HOST`, `OVH_USER`, `OVH_PASSWORD`, `OVH_KNOWN_HOSTS` (recommandé). `OVH_REMOTE_DIR` facultatif, défaut `www/nautical-apps/maree-faro`, doit finir par `/nautical-apps/maree-faro`.

## Source des données

API publique de l'Instituto Hidrográfico (marine portugaise) :

```
https://www.hidrografico.pt/hmapi/tidestation/?portID={PORTID}&startDate={YYYY-MM-DD}&period={N}
```

- `portID=19` → Faro-Olhão (Barra de Faro-Olhão)
- `startDate` → date de début, format `YYYY-MM-DD`
- `period` → nombre de jours (1 dans ce widget)

Réponse JSON, un item par événement de marée (Preia-Mar / Baixa-Mar), plus quelques items phase lunaire (`height: null`) à ignorer.

Couverture des données (vérifiée empiriquement, port 19) : du **01/01/2007** à fin **2027**. En dehors de cette plage, l'API répond 200 avec uniquement des items phase lunaire, sans marée.

**`period` plafonné à 7 jours.** Vérifié : `period=8` à `period=27` renvoient tous exactement les mêmes 7 jours que `period=7` — la valeur demandée au-delà de 7 est silencieusement ignorée. Pour couvrir une fenêtre plus large (le widget Übersicht charge -3/+21 jours), il faut enchaîner plusieurs appels de 7 jours et fusionner les résultats (voir `ubersicht-widget.jsx`, `command`, script Python).

## Problème CORS

L'API ne renvoie pas d'en-tête `Access-Control-Allow-Origin`. Ouvrir l'URL directement dans un navigateur fonctionne (simple navigation, pas de contrôle CORS), mais un `fetch()` JS depuis un autre domaine échoue (`Failed to fetch`).

Contournement dans `index.html` : tentative de fetch direct d'abord, puis repli sur le proxy `r.jina.ai` (lecteur web sans clé API) qui relaie la réponse. Voir fonction `fetchTides()`.

Point fragile : dépendance à un service tiers gratuit hors de notre contrôle. Si `r.jina.ai` change de comportement ou tombe, le widget échoue. Alternative plus pérenne : héberger un petit relai serveur soi-même (hors scope de cette page autonome).

## Widget Übersicht — dimensions fixes

Le widget garde des dimensions constantes quel que soit le jour affiché :

- **Amplitude verticale** : l'échelle de l'axe Y du graphique est calculée une fois sur l'ensemble des données chargées (-3/+21 jours), pas par jour affiché — sinon la courbe change de hauteur visuelle en changeant de jour.
- **Largeur** : le format d'affichage de la date (`jjj JJ/MM`, ex. `mer 01/01`, `ven 31/12`) fait toujours exactement 9 caractères, vérifié sur les 366 jours d'une année bissextile — aucune dérive possible (pas de nom de mois en toutes lettres, pas d'ordinal).
- Le panneau a une largeur fixée en dur (`400px`) sur l'élément réellement rendu (`.panel`), pas seulement sur le conteneur externe géré par Übersicht — sinon il se redimensionne au contenu le plus large (le titre) et dérive de quelques pixels selon les caractères.
- Le titre ne passe jamais à la ligne (`white-space: nowrap` + `text-overflow: ellipsis`), ce qui évite qu'une hauteur d'en-tête à une ligne certains jours et deux lignes d'autres jours ne fasse varier la hauteur totale.

## Widget Übersicht — résilience aux pannes de la source

Le 25/10/2026, tout le backend `hmapi` d'hidrografico.pt est tombé (HTTP 500 sur `tidestation`, 502 sur les autres endpoints), alors que le site principal répondait. Le widget affichait alors la trace Python brute.

Depuis :
- Le script sort toujours un JSON `{status, fetchedAt, error, data}` avec code de sortie 0 — jamais de traceback à l'écran.
- Chaque récupération réussie est mise en cache dans `~/Library/Caches/maree-faro/tides.json`.
- En cas d'échec, le cache est servi (`status: stale`) et la ligne "source" devient orange : `hidrografico.pt indisponible (HTTP 500) · données du 24/10 14:32`. Comme le widget charge ~25 jours d'avance, une panne de plusieurs jours reste invisible à l'usage.
- Sans cache (premier lancement pendant une panne) : message explicite, réessai automatique toutes les 5 min.
- Le bandeau remplace la ligne "source" au lieu de s'ajouter, pour ne pas changer la hauteur du widget.

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

Note : the widget shells out to python3, which isn't on macOS by default
