# Zapping

Un suivi de séries façon TVTime : cherche une série, coche les épisodes vus, et l'accueil te dit quoi regarder ensuite.

- **Catalogue** : [API TVmaze](https://www.tvmaze.com/api) (gratuite, sans clé)
- **Compte et progression** : Supabase (connexion par lien magique, données protégées par RLS)
- **Front** : Vite, React, TypeScript, sans autre dépendance
- **Hébergement** : Netlify, déployé automatiquement à chaque push sur `main`

## Fonctionnalités

- Recherche de séries et ajout à « Mes séries »
- Grille d'épisodes par saison : un tap coche ou décoche, le prochain épisode est entouré en ambre
- Proposition de cocher les épisodes précédents quand tu coches un épisode plus loin
- Cocher ou décocher une saison entière, liste détaillée des titres et dates de diffusion
- Accueil trié par activité récente : À voir (avec bouton « Vu » sur le prochain épisode), À jour (avec la date du prochain épisode), Terminées
- **Reprise** : colle une liste « Breaking Bad S05E08 » (une série par ligne), l'app retrouve
  chaque série sur TVmaze et coche tout ce qui précède le point indiqué — utile pour repartir
  d'un ancien suivi sans tout recocher à la main
- Thème clair et sombre automatique, pensé d'abord pour le mobile

## Mise en place

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com) (le plan gratuit suffit).
2. Dans **SQL Editor**, exécute le contenu de `supabase/schema.sql`.
3. Dans **Authentication → URL Configuration** :
   - *Site URL* : l'URL Netlify du site (`https://<nom-du-site>.netlify.app/`)
   - *Redirect URLs* : ajoute la même URL, plus `http://localhost:5173/` pour le dev.
4. Dans **Project Settings → API**, récupère l'URL du projet et la clé `anon` publique.

### 2. En local

```bash
cp .env.example .env   # puis remplis les deux valeurs
npm install
npm run dev
```

### 3. Netlify

1. Pousse le dépôt sur GitHub.
2. Sur [netlify.com](https://netlify.com) : **Add new site → Import an existing project**, choisis le dépôt.
   La commande de build et le dossier publié sont lus dans `netlify.toml`, rien à saisir.
3. **Site configuration → Environment variables** : ajoute `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
4. Redéploie une fois les variables ajoutées (**Deploys → Trigger deploy**), puis reporte l'URL du site
   dans la configuration Supabase de l'étape 1.

Ensuite chaque push sur `main` redéploie tout seul.

Astuce : sur iPhone ou Android, ajoute la page à l'écran d'accueil pour l'utiliser comme une app.

## Notes

- Le lien de connexion doit être ouvert dans le **même navigateur** que celui où tu l'as demandé (flux PKCE).
- Les fiches TVmaze sont mises en cache 12 h dans le navigateur ; les résumés sont en anglais.
- Les épisodes spéciaux (sans numéro) sont ignorés.
- Données séries fournies par TVmaze.com sous licence CC BY-SA.
