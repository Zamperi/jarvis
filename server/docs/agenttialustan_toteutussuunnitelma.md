# Agenttialustan Perustyökalujen Toteutussuunnitelma

## 1. Tavoite

Rakentaa agenttialusta, joka kykenee tutkimaan, dokumentoimaan ja
refaktoroimaan koodia turvallisesti, tehokkaasti ja läpinäkyvästi.
Toteutus perustuu selkeisiin työkalurajapintoihin, auditointiin ja
sääntöpohjaiseen ohjaukseen.

## 2. Tiedosto- ja koodivarastotyökalut

### 2.1 list_files

-   Toteutus: Node + glob.
-   Palauttaa polut ja mahdollistaa laajat haut (`src/**/*.ts`).
-   Tarvitaan projektin rakenteen ymmärtämiseen ja jatkotoimien
    kohdentamiseen.

### 2.2 read_file (range-tuettuna)

-   Tuki rivialueille ja byte-range-lukuun.
-   Estää kontekstin ylikuormittumisen LLM:lle.
-   Käytetään analysointiin, dokumentointiin ja yksittäisiin
    korjauksiin.

### 2.3 apply_patch

-   Käyttää unified diff -formaattia.
-   Hash-varmennus ennen kirjoitusta.
-   Tukee `dry_run`-tilaa.
-   Tämä on turvallisen refaktoroinnin ydin.

### 2.4 search_in_files

-   Teksti- ja regex-haku.
-   Käytetään symbolien paikantamiseen, funktioiden muutosten ja
    virheiden etsimiseen.

### 2.5 git-työkalut

-   `git_status`, `git_diff`, `git_commit`.
-   Mahdollistaa agentin työn seurannan ja turvalliset muutokset.

------------------------------------------------------------------------

## 3. Kieli- ja projektianalyysityökalut

### 3.1 TypeScript-analyzer

-   LSP/tsserver -integraatio.
-   `ts_get_ast_outline`: funktiot, luokat, exportit.
-   `ts_find_references`: symbolien kaikki esiintymät.
-   `ts_rename_symbol`: LSP-tason rename-refaktorointi.
-   `ts_check`: diagnostiset virheet.

### 3.2 Projektigrafi

-   Rakennetaan moduulien ja riippuvuuksien verkko.
-   Mahdollistaa hot spot -analyysin, rakenteelliset ongelmat ja
    refaktoroinnin suunnittelun.

------------------------------------------------------------------------

## 4. Dokumentointi- ja selitystyökalut

### 4.1 save_explanation

-   Tallentaa agentin tuottamat selitykset tiedostoon tai
    symbolialueeseen.
-   Rakentaa ymmärrettävää formaalia dokumentaatiota.

### 4.2 API-dokumenttien generointi

-   TypeDoc-wrapper.
-   Agentti voi analysoida tuotosta ja täydentää sitä.

### 4.3 Changelog-työkalu

-   Tuottaa commit-historian pohjalta muutoslogit.
-   Tukee auditointia.

------------------------------------------------------------------------

## 5. Refaktorointityökalut

### 5.1 refactor_rename_symbol

-   LSP-pohjainen turvallinen rename.

### 5.2 refactor_extract_function

-   Tekstipohjainen aloitus.
-   Myöhemmin AST-pohjainen.

### 5.3 refactor_move_file

-   Päivittää importit projektigrafin perusteella.

### 5.4 format_files ja lint_files

-   Prettier + ESLint.
-   Agentti ei muokkaa whitespacea käsin.

------------------------------------------------------------------------

## 6. Suoritus- ja testityökalut

### 6.1 run_tests

-   Palauttaa onnistuneet/epäonnistuneet ja tiiviit lokit.

### 6.2 run_build

-   `npm run build` tai `tsc`.
-   Toimii refaktoroinnin validointina.

------------------------------------------------------------------------

## 7. Sääntöjen ja valvonnan työkalut

### 7.1 Policy-checker

-   Arvioi jokaisen actionin:
    -   Sallitut polut
    -   Maksimisallitut muutokset
    -   Vaaralliset operaatiot estetään

### 7.2 Auditointi

-   `log_step` jokaisesta työkalukutsusta.
-   `log_diff` kaikista muutoksista.
-   Tuottaa täyden läpinäkyvyyden agentin työhön.

------------------------------------------------------------------------

## 8. Projektikonfiguraation lukija

### 8.1 read_project_config

-   Yhdistää kaikki projektin metadata-tiedostot:
    -   package.json
    -   tsconfig
    -   eslint/prettier
    -   testikonfigit
-   Agentti ymmärtää projektin rajat ja entry-points.

------------------------------------------------------------------------

## 9. Toteutusprioriteetit

### Vaihe 1 (välittömästi)

-   list_files\
-   read_file\
-   apply_patch\
-   search_in_files\
-   ts_get_ast_outline\
-   ts_check\
-   format_files\
-   lint_files\
-   run_tests\
-   policy-check + audit

### Vaihe 2 (viikko 1--2)

-   ts_find_references\
-   ts_rename_symbol\
-   projektigrafi\
-   extract_function\
-   move_file

### Vaihe 3 (jatkokehitys)

-   API-dokumenttigeneraattori\
-   Parempi AST-tason refaktorointi\
-   Syvempi auditointi + PR-autogenerointi

------------------------------------------------------------------------

## 10. Lopputulos

Kun nämä työkalut ovat käytössä, agentti pystyy tutkimaan koko projektin
rakenteen, tekemään muutoksia kontrolloidusti, validoimaan ne testeillä,
ja dokumentoimaan kaiken läpinäkyvästi. Tämä muodostaa perustan
korkealaatuiselle autonomiselle tuotekehitykselle.
