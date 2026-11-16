# User stories

**US1 — Voir l'état d'un coup d'œil.** En tant que client, je veux voir phase, gate en attente et employés actifs en haut de page.
- AC1 : Given une mission ouverte, When la page se charge, Then phase, nb d'employés actifs et état de connexion sont visibles sans défiler.
- AC2 : Given un gate en attente, When la page s'affiche, Then le panneau de validation est le premier bloc sous la barre de phases et reste visible au défilement.

**US2 — Savoir qui fait quoi.** 
- AC3 : Given des employés working/idle/blocked, When la salle est affichée, Then chaque statut a une icône/forme + libellé (pas seulement la couleur) et la note de l'employé actif est lisible.
- AC4 : Given aucun employé actif, Then un état vide explicite est affiché (pas de zone vide).

**US3 — Suivre les tâches.**
- AC5 : Given des tâches, When le tableau s'affiche, Then les colonnes To do / In progress / Done ont un compteur ; Given aucune tâche, Then un message vide s'affiche ; Given un titre long, Then il est tronqué sans casser la mise en page.

**US4 — Utiliser la console confortablement.**
- AC6 : Given une longue conversation, When un message arrive, Then la liste défile en bas et la zone de saisie reste visible ; les messages client/CEO/système sont distincts.

**US5 — Utiliser sur tout écran.**
- AC7 : Given une largeur de 360, 768, 1280 ou 2560 px, Then aucun défilement horizontal ; en <800 px les sections sont accessibles via onglets ; en grand écran le contenu ne s'étire pas indéfiniment.

**US6 — Accessibilité.**
- AC8 : Given navigation clavier, Then tous les contrôles ont un focus visible et un nom accessible ; le contraste texte/fond ≥ 4.5:1 ; `prefers-reduced-motion` désactive les animations.

## Cas limites
Aucune donnée (`state.empty`), worker déconnecté, noms/notes très longs, 14 employés actifs simultanément, nombreuses tâches (>50).
