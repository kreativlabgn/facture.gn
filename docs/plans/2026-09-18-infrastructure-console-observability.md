# Console infrastructure — observabilité réelle

## Contexte
`/admin/infrastructure` est actuellement une maquette. Les métriques et dossiers affichés sont codés en dur. Les APIs exposent déjà health checks, métriques Prometheus et files BullMQ, mais aucun snapshot métier sécurisé n'existe.

## Objectif
Créer une console d'exploitation lisible et compacte, alimentée par un snapshot backend partiel, sans exposer Redis, les payloads BullMQ ni le texte brut Prometheus au navigateur.

## Découpage
1. Ajouter une autorisation plateforme vérifiée en base, distincte des rôles organisationnels.
2. Exposer un snapshot Trust sécurisé avec états des services et compteurs BullMQ.
3. Exposer une sonde interne Money séparée par secret.
4. Remplacer la maquette infrastructure par des données serveur réelles et gérer les pannes partielles.
5. Intégrer la zone DAF réelle et ses états terminaux sans modifier les primitives de charte.

## Tests avant code
- guard plateforme: absent, refusé, autorisé, révocation en base;
- snapshot: files, seuils, panne partielle Money, timeout;
- endpoint Money: clé absente/invalide/valide;
- web: chargement, erreur partielle, absence de métriques de démonstration;
- DAF: objection/validation figent les boutons après succès.

## Sécurité
- Aucun endpoint d'observabilité admin ne sera public.
- `isPlatformAdmin` est relu à chaque requête.
- Les secrets inter-services restent distincts.
- Aucun payload, identifiant de job ou secret n'est renvoyé au navigateur.
