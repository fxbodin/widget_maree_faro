# Widget marées — Faro-Olhão

Page HTML autonome affichant graphiquement l'horaire des marées de Faro-Olhão (Portugal), avec sélecteur de date et ligne "agora" (heure locale) quand la date affichée est le jour courant.

## Fichier

`index.html` — pas de dépendance de build, ouvrir directement ou servir statiquement.

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

## Utilisation

Ouvrir `index.html` dans un navigateur, ou servir via un serveur statique quelconque :

```bash
python3 -m http.server 8000
```

puis `http://localhost:8000/index.html`.
