# Spécification — Bureau en salles et animations

## Problème
Le bureau du dashboard est une seule salle ouverte : on ne voit pas la structure de l'entreprise, et les animations sont limitées (poste / lounge).

## Objectifs
1. Une **salle par département** (Direction, Produit, Ingénierie, Qualité, Delivery), avec murs, nom et porte.
2. Une **salle de réunion** partagée (gates) et une **cafétéria** (employés inactifs).
3. Un **couloir central** reliant les salles, où l'on voit passer les employés.
4. Animation complète : travail au poste, déplacements par le couloir, visites entre salles, bulles de dialogue, portes qui s'ouvrent, salle éclairée quand on y travaille, célébration en salle de réunion aux gates approuvés.

## Hors périmètre
- Worker, API, base de données : inchangés. Aucune nouvelle dépendance (React 18 + Vite, CSS/SVG seulement).
- Pas de nouvelles données : tout se déduit de `agents`, `phase`, `validations` déjà fournis.
- Le reste du dashboard (console, tâches, etc.) est inchangé.

## Comportement
- **Placement** : un employé `working` ou `blocked` est à son bureau, dans la salle de son département. Un employé `idle` va à la cafétéria. Rôle inconnu / sans département : salle « Team ».
- **Salle active** : une salle avec au moins un employé `working` est éclairée (lueur, enseigne mise en évidence) ; sinon atténuée.
- **Déplacements** : un employé qui change de lieu sort par la porte de sa salle, traverse le couloir et entre dans la destination (transition CSS ≤ 1,5 s).
- **Visites** : quand deux employés de départements différents sont `working` en même temps, ou quand la phase change, l'employé concerné visite brièvement la salle de l'autre ; une bulle de dialogue (sa note, tronquée) s'affiche, puis il revient à son poste.
- **Portes** : s'ouvrent quand quelqu'un passe.
- **Gates** (`spec_gate`, `plan_gate`, `done_gate`) : le CEO est en salle de réunion tant qu'une validation est en attente. Quand elle est approuvée, une célébration (confettis CSS) y est jouée, via `useCelebration`.
- **Mouvement réduit** : avec `prefers-reduced-motion`, ni déplacement animé, ni visites, ni confettis ; les employés apparaissent à leur place.
- Employés sélectionnables au clavier (fiche employé existante).

## Critères d'acceptation
1. **Given** un roster complet, **When** le bureau s'affiche, **Then** 5 salles de département, une salle de réunion, une cafétéria et un couloir sont visibles, chacun avec son nom.
2. **Given** un employé `working`, **Then** il est à son bureau dans la salle de son département, éclairée.
3. **Given** un employé passant de `working` à `idle`, **Then** il traverse le couloir jusqu'à la cafétéria, et la salle s'atténue s'il était le dernier actif.
4. **Given** deux départements actifs ou un changement de phase, **Then** une visite avec bulle a lieu, puis l'employé revient.
5. **Given** une validation en attente, **Then** le CEO est en salle de réunion ; **When** elle est approuvée, **Then** une célébration est jouée.
6. **Given** un rôle inconnu ou `/api/roles` absent, **Then** l'affichage reste valide (salle « Team », aucune erreur).
7. **Given** `prefers-reduced-motion`, **Then** aucune animation de déplacement ni de confettis.
8. **Given** une largeur de 360 à 2560 px, **Then** le plan reste lisible (unités de conteneur, comme `CrewRoom`).
9. `npm test` (racine) et `npm run build` (dashboard) passent ; la logique pure nouvelle (affectation salle/poste, choix des visites) est dans `company.js` et testée avec `node:test`.

## Décisions
- Salles par département + réunion + cafétéria + couloir (réponses du client : A puis C).
- Zéro dépendance, CSS/SVG uniquement.
