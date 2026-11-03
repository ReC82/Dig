# Pilote italien — script de recette de 15 minutes (#59)

À transmettre tel quel au collègue italophone. Partie française pour le propriétaire, partie italienne pour le testeur.

## Pour le propriétaire (FR)

- L'italien est en **preview** : invisible pour les joueurs. Le testeur l'ouvre avec le lien ci-dessous ; ce choix ne concerne que son appareil.
- Les traductions de l'interface (579 textes) ont été produites par IA (Claude), puis passées par les contrôles automatiques : 0 erreur. Aucune n'a encore été relue par un locuteur natif.
- Restent en français (normal à ce stade) : thème et nom de saison, collections saisonnières, actualités, événements, badges saisis dans l'admin, messages d'erreur détaillés du serveur, e-mails.
- Retours du testeur : les noter dans la feuille `relecture-it.csv` (colonne `correction`), produite par `node tools/i18n/cli.js export it relecture-it.csv`, puis `import it relecture-it.csv --by "<prénom>"`. Ses corrections sont protégées : l'IA ne les écrasera jamais.

---

## Per il tester (IT)

Grazie per l'aiuto! DIG! è un gioco "idle clicker": scavi blocchi, guadagni monete e scendi sempre più in profondità. La versione italiana è nuova e tradotta automaticamente: cerchiamo tutto ciò che suona strano, sbagliato o poco naturale. Tempo: circa 15 minuti, meglio dal **telefono**.

**Link:** https://dig.lodylands.com/?lang=it

Per ogni problema annota: **dove** (schermata), **testo visto**, **proposta**. Uno screenshot aiuta.

### 1. Primo impatto (2 min)
1. Apri il link. Il gioco deve essere in italiano (barra in basso: Scava · Potenzia · Collezione · Giornaliero · Negozio · Stagione).
2. Tocca il blocco al centro più volte. Si capisce cosa fare? Le scritte che compaiono (danni, monete, "FORZIERE!", "GEMMA!") sono chiare?

### 2. Capire il gioco (3 min)
3. Apri **Potenzia**: leggi Piccone, Fortuna, Sacca, Auto-Dig, Frammenti, Cambia blocco. Le descrizioni sono comprensibili? I plurali sono corretti ("1 danno" / "3 danni")?
4. Più in basso: **Negozio stagionale** e **Obiettivi**. Tocca "ℹ️ Ricompense e probabilità" su un forziere: il testo lungo si capisce?

### 3. Collezioni e storie (3 min)
5. Apri **Collezione**: oggetti, reliquie (es. "Occhio del minatore", "Calamita di schegge"), badge. I nomi suonano bene in italiano? Le brevi storie sono naturali?
6. Se trovi un oggetto, tocca la scheda: data, quantità, testo.

### 4. Umorismo e tono (2 min)
7. Il tono è amichevole (si usa il "tu")? C'è qualcosa di troppo letterale, rigido o buffo nel senso sbagliato? Nomi come "Spaccatutto", "Fai-da-te", "Cacciatore di tesori" funzionano?

### 5. Negozi e punti (2 min)
8. Apri **Negozio** (gemme, skin, boost) e **Stagione** → punti premio e negozio dei regali. I termini (monete, gemme, frammenti, punti premio, scambio) sono chiari e coerenti?

### 6. Messaggi d'errore e account (2 min)
9. ⚙ Impostazioni → Account: prova ad accedere con una password sbagliata. Il messaggio è chiaro?
10. Guarda "Crea un account" e "Password dimenticata?".

### 7. Stagione e mobile (1 min)
11. Apri **Stagione** e "ℹ️ Come funziona la stagione?". (Il nome del tema della settimana resta in francese: è previsto.)
12. Qualche testo è tagliato, va a capo male o esce dallo schermo? Indica la schermata.

### Fine
- Per tornare al francese: ⚙ Impostazioni → Lingua → Français.
- Un voto da 1 a 5: "Un giocatore italiano capirebbe e apprezzerebbe il gioco così com'è?"

Grazie mille!
