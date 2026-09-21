# Zapping

Un suivi de séries façon TVTime : cherche une série, coche les épisodes vus, et l'accueil te dit quoi regarder ensuite.

- **Catalogue séries** : [API TVmaze](https://www.tvmaze.com/api) (gratuite, sans clé)
- **Catalogue films** : [TMDB](https://www.themoviedb.org/) (gratuite, clé requise — facultatif)
- **Compte et progression** : Supabase (connexion par lien magique, données protégées par RLS)
- **Front** : Vite, React, TypeScript, sans autre dépendance
- **Hébergement** : Netlify, déployé automatiquement à chaque push sur `main`

## Fonctionnalités

- Recherche de séries et ajout à « Mes séries »
- Grille d'épisodes par saison : un tap coche ou décoche, le prochain épisode est entouré en ambre
- Proposition de cocher les épisodes précédents quand tu coches un épisode plus loin
- Cocher ou décocher une saison entière, liste détaillée des titres et dates de diffusion
- Accueil trié par activité récente : À voir (avec bouton « Vu » sur le prochain épisode), À jour (avec la date du prochain épisode), Terminées
- **Statuts** : En cours, En pause, À regarder plus tard, Abandonnée. Seules les séries « en cours »
  alimentent À voir / À jour ; les autres ont leur propre section sur l'accueil
- **Dates de visionnage** : chaque épisode coché retient son jour, affiché dans la liste des titres.
  La date peut rester inconnue — mieux vaut « vu, sans savoir quand » qu'une date inventée, qui
  ferait un faux pic dans les statistiques
- **Revisionnages** : un compteur « vue N fois » par série, qui multiplie son temps dans les
  statistiques — revoir une série, c'est y avoir vraiment passé ce temps une fois de plus
- **Statistiques** : temps total, séries les plus regardées. Les durées viennent de
  TVmaze ; un épisode sans durée prend la durée médiane de sa série. Le graphique a son
  équivalent en tableau
- **Films** : recherche TMDB, marquage « vu le … » et liste « Mes films »
- **Où la regarder** : sur la fiche d'une série, les plateformes qui la proposent en abonnement
  en France (données JustWatch via TMDB, nécessite la clé)
- **Import Netflix** : dépose le `NetflixViewingHistory.csv` de ton profil, l'app regroupe par
  œuvre, retrouve chaque série et coche les épisodes avec leurs dates réelles. Une case
  « Corriger les dates déjà enregistrées » permet de repasser sur des dates fausses laissées par
  une reprise antérieure ; sans elle, les épisodes déjà cochés sont laissés tels quels
- **Liste à coller** : une ligne par titre (« Breaking Bad S05E08 »), avec une date facultative
  (« The Boys S01E08 @ 12/03/2024 »). Un titre inconnu au catalogue séries est cherché parmi les
  films — c'est la voie pour Prime Video, Disney+ ou Apple TV, qui n'exportent pas d'historique
- **Corriger une ligne introuvable** : sur les deux écrans d'import, une ligne « Introuvable » a un
  bouton « Corriger » qui ouvre une recherche manuelle (le bon titre, choisi dans les résultats)
  sans quitter l'écran ni recoller la liste
- Thème clair et sombre automatique, pensé d'abord pour le mobile

## Mise en place

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com) (le plan gratuit suffit).
2. Dans **SQL Editor**, exécute le contenu de `supabase/schema.sql`.
3. Dans **Authentication → Email Templates → Magic Link**, ajoute `{{ .Token }}` quelque part dans le
   corps du message (par exemple : `Ton code : {{ .Token }}`). L'app se connecte par un code à 6
   chiffres, pas par le lien — sans cette ligne, l'e-mail ne contient aucun code à saisir.
4. Dans **Authentication → URL Configuration** :
   - *Site URL* : l'URL Netlify du site (`https://<nom-du-site>.netlify.app/`)
   - *Redirect URLs* : ajoute la même URL, plus `http://localhost:5173/` pour le dev.
5. Dans **Project Settings → API**, récupère l'URL du projet et la clé `anon` publique.

### 2. Films (facultatif)

Sans clé TMDB, l'app fonctionne normalement mais l'onglet Films affiche un message et l'import
Netflix ignore les films. Pour les activer : crée un compte sur
[themoviedb.org](https://www.themoviedb.org/settings/api) et demande un accès à l'API (gratuit,
choisis *Website* comme type d'utilisation).

Leur page donne deux identifiants ; `VITE_TMDB_KEY` accepte l'un ou l'autre :

- **Clé de l'API** (v3) : 32 caractères, envoyée en paramètre d'URL ;
- **Jeton d'accès en lecture à l'API** (v4) : un JWT commençant par `eyJ`, envoyé en en-tête
  `Authorization: Bearer`.

Les variables `VITE_*` sont compilées dans le bundle : après en avoir ajouté une sur Netlify,
il faut relancer un déploiement pour qu'elle soit prise en compte.

### 3. En local

```bash
cp .env.example .env   # puis remplis les deux valeurs
npm install
npm run dev
```

### 4. Netlify

1. Pousse le dépôt sur GitHub.
2. Sur [netlify.com](https://netlify.com) : **Add new site → Import an existing project**, choisis le dépôt.
   La commande de build et le dossier publié sont lus dans `netlify.toml`, rien à saisir.
3. **Site configuration → Environment variables** : ajoute `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   et, si tu veux les films, `VITE_TMDB_KEY`.
4. Redéploie une fois les variables ajoutées (**Deploys → Trigger deploy**), puis reporte l'URL du site
   dans la configuration Supabase de l'étape 1.

Ensuite chaque push sur `main` redéploie tout seul.

Astuce : sur iPhone ou Android, ajoute la page à l'écran d'accueil pour l'utiliser comme une app.

## Notes

- **Connexion par code** (pas par lien) : un code à 6 chiffres envoyé par e-mail, saisi dans l'app.
  Choisi pour l'app ajoutée à l'écran d'accueil (mode standalone) : un lien magique s'ouvrirait dans
  le navigateur plutôt que dans l'app, et le vérificateur PKCE posé au moment de l'envoi ne s'y
  retrouve pas pour conclure la connexion. Le code se saisit sans changer de contexte.
  Nécessite `{{ .Token }}` dans le modèle d'e-mail « Magic Link » de Supabase (voir mise en place).
- **Icône d'écran d'accueil** : un manifeste PWA (`public/manifest.webmanifest`) et les icônes
  associées permettent d'ajouter Zapping à l'écran d'accueil avec sa propre icône, en plein écran.
- Les fiches TVmaze sont mises en cache 12 h dans le navigateur ; les résumés sont en anglais.
- Les épisodes spéciaux (sans numéro) sont ignorés.
- **Import Netflix** : l'export ne donne que le titre traduit de l'épisode et le jour de
  visionnage, sans numéro de saison fiable ni identifiant. Quand les titres traduits ne
  correspondent pas au catalogue (le cas des séries anglophones), l'app coche autant d'épisodes
  que de lignes vues, dans l'ordre de diffusion, et le signale par l'étiquette « estimé ».
  L'étiquette « par titre » veut dire que chaque épisode a été reconnu à son nom. L'écran de
  relecture permet de tout décocher avant d'enregistrer.
- Une œuvre vue une seule fois et sans mention de saison est proposée comme film ; un bouton
  permet de la rebasculer en série (et inversement).
- Le schéma `supabase/schema.sql` est ré-exécutable : relance-le après une mise à jour pour
  ajouter les nouvelles colonnes et tables.
- La disponibilité passe par l'IMDb que TVmaze publie dans `externals`, seul pont fiable vers
  TMDB. Une série sans identifiant IMDb n'affiche pas de badge, et une absence de badge signifie
  « pas en abonnement chez les plateformes suivies », pas « indisponible ».
- Données séries fournies par TVmaze.com sous licence CC BY-SA. Données films et disponibilités
  fournies par TMDB et JustWatch (ce produit n'est ni approuvé ni certifié par TMDB).
