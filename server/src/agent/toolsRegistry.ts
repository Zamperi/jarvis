// src/agent/toolsRegistry.ts
// Vain LLM:lle näkyvä tools-schema (nimi, kuvaus, parametrit)
export const tools: any[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Lue tiedoston sisältö suhteellisella polulla projektin juuresta (valinnainen rivialue).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          fromLine: { type: "integer", minimum: 1 },
          toLine: { type: "integer", minimum: 1 },
          maxBytes: { type: "integer", minimum: 1 },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Luo tai ylikirjoittaa tiedoston annetulla sisällöllä suhteellisella polulla projektin juuresta.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Tiedoston polku projektin juuresta (esim. 'docs/README.md').",
          },
          content: {
            type: "string",
            description:
              "Tiedoston sisältö UTF-8 -merkkijonona.",
          },
          estimatedChangedLines: {
            type: "integer",
            minimum: 0,
            description:
              "Arvio muutettavien rivien määrästä politiikkaa varten. Ei pakollinen.",
          },
        },
        required: ["filePath", "content"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "Listaa tiedostot glob-patternien perusteella projektin juuren alta.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
          },
          ignore: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files_by_name",
      description:
        "Hae tiedostoja nimen tai sen osan perusteella projektin juuren alta. Ensin haetaan tarkka osuma tiedoston nimeen, sitten osittaiset osumat.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          patterns: {
            type: "array",
            items: { type: "string" },
          },
          ignore: {
            type: "array",
            items: { type: "string" },
          },
          maxResults: { type: "integer", minimum: 1 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_files",
      description:
        "Hae tekstiä tai regexiä useista tiedostoista glob-patternien perusteella.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
          },
          query: { type: "string" },
          isRegex: { type: "boolean" },
          ignore: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["patterns", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Sovella unified diff -muotoinen patch tiettyyn tiedostoon (käytä aina varovasti ja selitä muutokset).",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          originalHash: { type: "string" },
          patch: { type: "string" },
          estimatedChangedLines: { type: "integer", minimum: 0 },
          dryRun: { type: "boolean" },
        },
        required: ["filePath", "originalHash", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ts_get_outline",
      description:
        "Palauta TypeScript-tiedoston outline: funktiot, luokat, tyypit, interfacet jne.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ts_check",
      description:
        "Aja TypeScript-tyypitystarkistus koko projektille tsconfigin perusteella.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description:
        "Aja projektin testit (esim. npm/yarn test). Palauta lyhyt yhteenveto.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_build",
      description:
        "Aja projektin build-komento (esim. npm/yarn build). Palauta lyhyt yhteenveto.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_lint",
      description:
        "Aja projektin lint-komento (esim. npm/yarn lint). Palauta lyhyt yhteenveto.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },

  // -------- Projektin ymmärtäminen / konteksti --------

  {
    type: "function",
    function: {
      name: "get_project_info",
      description:
        "Palauta tiivis yhteenveto projektista: package.json- ja tsconfig-perustiedot sekä tärkeimmät entrypoint-kandidaatit.",
      parameters: {
        type: "object",
        properties: {
          includePackageJson: { type: "boolean" },
          includeTsconfig: { type: "boolean" },
          scanEntryPoints: { type: "boolean" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_json_compact",
      description:
        "Lue JSON-tiedosto ja palauta kompakti versio. Voit valita avaimet ja rajoittaa merkkijonojen pituutta kustannusten säästämiseksi.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          pickKeys: {
            type: "array",
            items: { type: "string" },
          },
          maxStringLength: { type: "integer", minimum: 10 },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_run_log",
      description:
        "Palauta lokitiedoston loppu (esim. viimeiset virheet). Hyödyllinen kun haluat nähdä, miksi komento tai testi epäonnistui.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxChars: { type: "integer", minimum: 100 },
        },
        required: ["path"],
      },
    },
  },
];
