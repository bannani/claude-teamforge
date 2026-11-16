# Plan — Bureau en salles et animations

Périmètre : `dashboard/src` (React 18 + Vite), CSS/SVG, zéro dépendance. Worker et API inchangés.
Base existante : `company.js` (`officeLayout`), `CrewRoom.jsx` (`useMotion`, `Crewmate`), `useCelebration.js`, `styles.css` (section « crew room »).
La logique pure nouvelle va dans `company.js` et est testée avec `node:test` (`tests/office.test.mjs`).

## Tâches
1. **Plan des salles** (`company.js`) : `ROOMS` (rectangles en % : 5 départements, réunion, cafétéria, couloir, position des portes) ; `officeLayout(roster)` renvoie bureaux par salle, places en cafétéria, places en réunion, point de porte. Département inconnu → salle « Team ». Test `office.test.mjs`.
2. **Affectation et visites** (`company.js`) : `placeOf(person, ctx)` (working/blocked → bureau ; idle → cafétéria ; CEO → réunion si gate en attente) ; `pickVisit(roster, phase)` (deux départements actifs ou changement de phase). Tests unitaires.
3. **Rendu des salles** (`CrewRoom.jsx`, `styles.css`) : salles avec murs, enseigne, porte, couloir, mobilier CSS ; salle éclairée si un employé y travaille, sinon atténuée ; `role="group"` + `aria-label`.
4. **Déplacements par le couloir** (`CrewRoom.jsx`) : trajet en 3 segments (porte de départ → couloir → porte d'arrivée) basé sur `useMotion` ; portes qui s'ouvrent au passage.
5. **Visites et bulles** (`CrewRoom.jsx`) : minuteur de visite via `pickVisit`, bulle avec la note tronquée, retour au poste.
6. **Gates** : `Company.jsx` reçoit `validations` (depuis `App.jsx`) ; le CEO va en réunion pendant un gate en attente ; confettis à l'approbation en réutilisant `burstConfetti`/`useCelebration`.
7. **Mouvement réduit et accessibilité** : `prefers-reduced-motion` désactive déplacements, visites, confettis ; cibles ≥ 40 px, contraste ≥ 4.5:1 ; états vide (« Aucun employé ») et chargement conservés.
8. **Vérifications** : `npm test` (racine), `npm run build` (dashboard), contrôle manuel à 360/768/1280/2560 px, revue sécurité (pas d'injection HTML, pas de dépendance), README mis à jour.

## Ordre / dépendances
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

## Risques
- Pas de test UI automatisé : vérification par build + inspection aux 4 largeurs.
- Ne pas casser le contrat des props ni `useTeamState` / `useChat` (seul ajout : prop `validations` de `Company`).
- Sur petit écran, les salles doivent rester lisibles : tout est en unités de conteneur (`cqw`).
