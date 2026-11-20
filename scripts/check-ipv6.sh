#!/bin/sh
# Audit IPv6 en LECTURE SEULE de node1 : rien n'est écrit ni modifié.
# Usage : ./scripts/check-ipv6.sh   (DOMAIN=autre.exemple pour un autre nom)
# Code de retour : 0 = rien d'exposé détecté ; 1 = exposition détectée ; 2 = outil indispensable absent.
# Voir docs/ipv6.md. Les commandes sudo sont tentées sans mot de passe (`sudo -n`) et ignorées si refusées.
set -u
DOMAIN="${DOMAIN:-plantes.tvermorel.fr}"
OK_PORTS="${OK_PORTS:-80 443}" # ports qu'on accepte de voir joignables en IPv6
exposed=0
warn() { echo "  ! $*"; }
expose() { echo "  X EXPOSE : $*"; exposed=$((exposed + 1)); }
title() { printf '\n== %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

have ip || { echo "commande 'ip' absente"; exit 2; }
have ss || { echo "commande 'ss' absente"; exit 2; }

title "1. Adresses IPv6 globales (hors loopback, lien-local fe80::, ULA fc/fd)"
globals=$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $2, $4}' | grep -viE ' (fe80|fc|fd)' || true)
if [ -n "$globals" ]; then
  echo "$globals" | sed 's/^/  /'
  warn "cette machine a une adresse IPv6 joignable de l'extérieur (si le routeur ne filtre pas)"
  has_global=1
else
  echo "  aucune : la machine n'est pas joignable en IPv6 depuis Internet"
  has_global=0
fi
echo "  route par défaut IPv6 : $(ip -6 route show default 2>/dev/null | head -1 | sed 's/^$//')"

title "2. Pare-feu IPv6 (entrée)"
fw="inconnu"
if have nft && sudo -n nft list ruleset >/dev/null 2>&1; then
  if sudo -n nft list ruleset | awk '/hook input/' | grep -q 'policy drop'; then fw="drop (nftables)"; else fw="accept (nftables, pas de policy drop en input)"; fi
elif have ip6tables && sudo -n ip6tables -S >/dev/null 2>&1; then
  if sudo -n ip6tables -S INPUT | grep -q '^-P INPUT DROP'; then fw="drop (ip6tables)"; else fw="accept (ip6tables)"; fi
elif have ufw && sudo -n ufw status >/dev/null 2>&1; then
  if sudo -n ufw status verbose | grep -qi 'Default: deny (incoming)'; then fw="drop (ufw)"; else fw="accept (ufw)"; fi
else
  warn "pare-feu illisible sans mot de passe sudo (lancer en root, ou 'sudo ip6tables -S' / 'sudo nft list ruleset' à la main)"
fi
echo "  état : $fw"

title "3. Services en écoute sur toutes les interfaces ([::] ou 0.0.0.0)"
# ss -H : sans en-tête ; -p : processus (visible en entier seulement pour root)
listen=$( { ss -H -tlnp 2>/dev/null; ss -H -ulnp 2>/dev/null; } | awk '{print $1, $4, $NF}' )
echo "$listen" | while read -r proto addr proc; do
  [ -n "$addr" ] || continue
  case "$addr" in 127.*|\[::1\]*|*%lo:*|\[fe80*) continue ;; esac
  echo "  $proto $addr $proc"
done
# Ports en écoute sur [::] (IPv6 : un socket [::] accepte aussi l'IPv4 sauf bindv6only=1)
v6ports=$(echo "$listen" | awk '$2 ~ /^(\[::\]|\*):[0-9]+$/ || $2 ~ /^\[::\]:/ {n=split($2,a,":"); print a[n]}' | sort -un)
echo "  sysctl net.ipv6.bindv6only = $(sysctl -n net.ipv6.bindv6only 2>/dev/null || echo ?)"
for p in $v6ports; do
  allowed=0; for o in $OK_PORTS; do [ "$p" = "$o" ] && allowed=1; done
  [ "$allowed" = 1 ] && continue
  if [ "$has_global" = 1 ]; then
    case "$fw" in drop*) warn "port $p sur [::] mais pare-feu en drop : vérifier qu'il est bien exclu des exceptions" ;;
      *) expose "port $p en écoute sur [::] avec une adresse globale et sans pare-feu IPv6 restrictif" ;; esac
  else
    warn "port $p sur [::] (sans adresse globale : sans effet aujourd'hui, mais le deviendrait avec un préfixe IPv6)"
  fi
done

title "4. Ports publiés par Docker"
if have docker && docker ps >/dev/null 2>&1; then
  docker ps --format '  {{.Names}}  {{.Ports}}'
  pub=$(docker ps --format '{{.Ports}}' | tr ',' '\n' | grep -E '(0\.0\.0\.0|\[::\]):[0-9]+' | sed -E 's/^ *//' || true)
  if [ -n "$pub" ]; then
    echo "$pub" | sed -E 's/^(0\.0\.0\.0|\[::\]):([0-9]+).*/\2/' | sort -un | while read -r p; do
      allowed=0; for o in $OK_PORTS; do [ "$p" = "$o" ] && allowed=1; done
      [ "$allowed" = 0 ] && echo "  ! port $p publié sur toutes les interfaces (hors $OK_PORTS)"
    done
    # Compte (hors sous-shell) des ports non attendus, publiés sur [::]
    for p in $(echo "$pub" | grep -E '^\[::\]' | sed -E 's/^\[::\]:([0-9]+).*/\1/' | sort -un); do
      allowed=0; for o in $OK_PORTS; do [ "$p" = "$o" ] && allowed=1; done
      if [ "$allowed" = 0 ] && [ "$has_global" = 1 ]; then expose "port Docker $p publié sur [::]"; fi
    done
  fi
  if [ -r /etc/docker/daemon.json ]; then echo "  daemon.json : $(tr -d '\n ' < /etc/docker/daemon.json)"; else echo "  daemon.json : absent ou illisible"; fi
else
  warn "docker indisponible ou non autorisé pour cet utilisateur"
fi

title "5. DNS de $DOMAIN"
if have dig; then
  a=$(dig +short A "$DOMAIN" | tr '\n' ' '); aaaa=$(dig +short AAAA "$DOMAIN" | tr '\n' ' ')
elif have getent; then
  a=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' '); aaaa=$(getent ahostsv6 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')
else
  a="?"; aaaa="?"; warn "ni dig ni getent"
fi
echo "  A    : ${a:-aucun}"
echo "  AAAA : ${aaaa:-aucun}"
if [ -n "${aaaa% }" ] && [ "$aaaa" != "? " ]; then
  if [ "$has_global" = 0 ]; then expose "AAAA publié ($aaaa) mais la machine n'a pas d'adresse IPv6 globale : les clients IPv6 n'aboutiront pas"
  else warn "AAAA publié : vérifier qu'il pointe bien vers cette machine ($globals)"; fi
fi

title "Résultat"
if [ "$exposed" -gt 0 ]; then echo "  $exposed exposition(s) détectée(s) : voir docs/ipv6.md"; exit 1; fi
echo "  rien d'exposé détecté (vérifier aussi depuis l'extérieur : docs/ipv6.md)"
exit 0
