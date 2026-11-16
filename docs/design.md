# Design — Bureau en salles

## Plan (vue du dessus, unités `cqw`)
```
+-----------+-----------+-----------+
| Direction | Produit   | Delivery  |
+---[porte]-+---[porte]-+---[porte]-+
|          COULOIR CENTRAL          |
+---[porte]-+---[porte]-+---[porte]-+
| Ingénierie| Qualité   | Réunion   |
+-----------+-----------+-----------+
|        Cafétéria (inactifs)       |
+-----------------------------------+
```
- Salle : fond sombre du thème, murs épais, enseigne (nom) en haut, porte vers le couloir, couleur d'accent du département.
- Couloir : bande claire avec lignes de sol ; les employés en déplacement y marchent (légère oscillation).
- Réunion : table centrale ; cafétéria : tables et plantes simples en CSS.

## États
- **Salle active** : lueur d'accent, enseigne pleine opacité. **Inactive** : atténuée.
- **Vide** : message « Aucun employé », plan visible. **Chargement** : plan squelette (`aria-busy`).
- **Bloqué** : icône + libellé, pas seulement la couleur.

## Animations
- Déplacement : transition `transform` 1,2 s ease-in-out ; porte : rotation 0,3 s ; bulle visible 3 s ; confettis CSS 2 s.
- `prefers-reduced-motion` : transitions à 0, confettis et visites désactivés.

## Accessibilité
- Chaque salle : `role="group"` + `aria-label` (nom + nombre d'actifs). Employés focusables, contraste ≥ 4.5:1, cibles ≥ 40 px tactile.
