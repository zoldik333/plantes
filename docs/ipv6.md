# Exposition IPv6 de node1

## Constats

Mesuré depuis le Mac le 20/11/2026 :
- `dig AAAA plantes.tvermorel.fr` : **aucun enregistrement AAAA** ; `A` = `82.67.218.121`. Aucun AAAA non plus sur `tvermorel.fr`.

**Non mesuré** : l'audit de `node1` n'a pas pu être fait (SSH vers `192.168.1.10` : délai dépassé, la session d'audit n'était pas sur le LAN ni sur Tailscale). On ne sait donc pas si `node1` a une adresse IPv6 globale, quels services écoutent sur `[::]` ni s'il existe un pare-feu IPv6. À lancer par Théo : `scripts/check-ipv6.sh` (ci-dessous).

Suppositions (à confirmer par l'audit) : Debian 13 n'installe aucun pare-feu actif par défaut ; Docker publie 80/443 via `docker-proxy`, qui écoute aussi sur `[::]` ; SSH écoute sur `[::]:22`.

## Le risque

En IPv4, la box fait du NAT : seuls 80/443 sont redirigés. En IPv6, si la box attribue un préfixe global à `node1` et ne filtre pas l'entrant (beaucoup de box laissent passer par défaut, ou un pare-feu « simple » peut être désactivé), **tout service qui écoute sur `[::]`** (SSH, ports Docker publiés, autres conteneurs) est joignable depuis Internet. Un futur enregistrement AAAA, lui, enverrait les clients IPv6 vers une adresse qui peut ne pas être la bonne ou ne rien servir (Let's Encrypt validerait alors en IPv6).

## 1. Auditer node1 (lecture seule)

```sh
ssh zoldik333@192.168.1.10
cd ~/plantes && sudo ./scripts/check-ipv6.sh      # sudo : pare-feu et processus lisibles ; sans sudo, ces parties sont ignorées
```
Code de retour 1 = exposition détectée. Le script n'écrit rien. Il liste : adresses IPv6 globales, état du pare-feu IPv6, sockets en écoute, ports Docker, A/AAAA du domaine.

## 2. Tester depuis l'extérieur (4G)

Les sites « test IPv6 » vérifient seulement que le client a de l'IPv6 ; ils ne scannent pas les ports.

1. Sur `node1` : `ip -6 -o addr show scope global` : l'adresse `2xxx:...` (la plus longue sans `temporary`/`deprecated`) est l'adresse à tester. Si rien n'apparaît, `node1` n'a pas d'IPv6 global et le risque est nul aujourd'hui.
2. Depuis un hôte hors du réseau avec IPv6 (VPS, ou iPhone en 4G partageant la connexion avec un Mac : vérifier d'abord `curl -6 -s https://ifconfig.co`, un opérateur sans IPv6 donne une erreur) :
   ```sh
   nmap -6 -Pn -p 22,80,443,3000 <adresse-ipv6-de-node1>
   nmap -6 -Pn -sU -p 443 <adresse>       # HTTP/3 (UDP, résultats peu fiables)
   ```
   Attendu avec la recommandation : tout `filtered`, y compris 80/443. Sans nmap : `nc -6 -vz -w 3 <adresse> 22`.
3. iPhone seul : une app de scan de ports (ex. « Fing » ou « Network Analyzer » en mode scan externe) acceptant une adresse IPv6, en 4G sans wifi.

## 3. Décision recommandée : AUCUNE exposition IPv6

Raison : l'IPv4 suffit (IP publique statique), et l'IPv6 n'apporte rien à un foyer de 2-3 personnes. Donc : pas d'AAAA, et pare-feu IPv6 en DROP par défaut à l'entrée (règles dans `scripts/ipv6-lockdown.nft`, table à part qui ne touche ni l'IPv4 ni Docker ; lo, connexions établies, ICMPv6, lien-local/ULA et `tailscale0` restent acceptés, donc SSH par LAN ou Tailscale marche toujours).

Commande unique à lancer par Théo sur `node1` (appliquée seulement en mémoire, perdue au redémarrage tant que non persistée) :
```sh
cd ~/plantes && git pull && sudo nft -f scripts/ipv6-lockdown.nft && sudo nft list table ip6 plantes_v6 && sudo ./scripts/check-ipv6.sh
```
Garder une 2e session SSH ouverte pendant l'application. Puis tester `https://plantes.tvermorel.fr` (IPv4, doit répondre) et refaire le scan 4G.

Persister (après validation) :
```sh
sudo sh -c 'cat ~/plantes/scripts/ipv6-lockdown.nft | grep -v "^#!" >> /etc/nftables.conf'   # ou : echo "include \"/home/zoldik333/plantes/scripts/ipv6-lockdown.nft\"" | sudo tee -a /etc/nftables.conf
sudo systemctl enable --now nftables
```
(Si `nftables` n'est pas installé : `sudo apt install nftables`. Si `ufw` est actif, utiliser plutôt `sudo ufw default deny incoming` et `IPV6=yes` dans `/etc/default/ufw`, puis `sudo ufw allow from 192.168.1.0/24 to any port 22` ; ne pas mélanger ufw et ce fichier.)

**Retour arrière** :
```sh
sudo nft delete table ip6 plantes_v6
# si persisté : retirer le bloc de /etc/nftables.conf, puis : sudo systemctl disable --now nftables
```

Le fichier `.nft` n'a pas pu être validé sur la machine d'audit (pas de `nft`) : lancer d'abord `sudo nft -c -f scripts/ipv6-lockdown.nft` (vérification sans application).

## Variante : IPv6 assumé, limité à Caddy

Ajouter dans la chaîne `input` du fichier `.nft` : `tcp dport { 80, 443 } accept` et `udp dport 443 accept`, créer l'enregistrement `AAAA plantes` chez OVH avec l'adresse globale **stable** de `node1` (vérifier qu'elle ne change pas : adresse temporaire/privacy, préfixe dynamique), et vérifier que l'app (port 3000) reste liée à `127.0.0.1` (c'est le cas dans `compose.yaml`). Le préfixe IPv6 d'un FAI domestique peut changer : un AAAA périmé casserait l'accès pour les clients IPv6. C'est pourquoi on ne le recommande pas.

## Durcissements dans le dépôt

`compose.yaml` : le port 3000 est déjà lié à `127.0.0.1`, seuls 80/443 (TCP) et 443 (UDP) sont publiés sur toutes les interfaces ; rien à changer sans preuve de l'audit. `Caddyfile` : inchangé (aucune dépendance à IPv6).

## Constat réel et correction (20/11/2026)

- Mesuré sur `node1` : adresse IPv6 globale `enp2s0` (préfixe dynamique `/64`), route par défaut IPv6, services en écoute sur `[::]` (SSH, Jellyfin, Sonarr, Radarr, Prowlarr, Bazarr, Seerr, FlareSolverr, Caddy). Pare-feu non lisible sans `sudo`.
- Mesuré depuis l'iPhone en 4G : Jellyfin (`:8096`) et Sonarr (`:8989`) répondaient. La box ne filtrait donc pas l'entrant IPv6.
- Corrigé : `scripts/ipv6-lockdown.nft` appliqué, puis rendu permanent par un service systemd `plantes-ipv6-lockdown.service` (oneshot, charge uniquement cette table). Vérifié : les deux adresses ne répondent plus en 4G, `https://plantes.tvermorel.fr` répond, SSH par Tailscale fonctionne.
- Pourquoi pas `nftables.service` : le `/etc/nftables.conf` de Debian commence par `flush ruleset`, ce qui effacerait les règles de Docker.
- Restant : fermer l'entrant IPv6 dans la box (Freebox OS), en plus du pare-feu de `node1`.
