// src/config/projectConfig.ts
import path from "path";

export const PROJECT_ROOT = path.resolve(
  process.env.AGENT_PROJECT_ROOT ?? process.cwd()
);

// Voit lisätä rooleja myöhemmin, nyt pidetään nämä selkeinä.
export type AgentRole = "coder" | "documenter";

export interface FileAccessConfig {
  rootDir: string;
}

// Yksinkertainen juurikonfigi, jos jossain tätä käytetään
export const fileAccessConfig: FileAccessConfig = {
  rootDir: PROJECT_ROOT,
};

export interface RoleAccessRule {
  /**
   * Glob-kuviot, joihin rooli SAA kohdistaa operaatioita (luku ja/tai kirjoitus).
   * esim. "src/**", "docs/**", "README.md", "*.md"
   */
  allowedPaths: string[];
  /**
   * Glob-kuviot, jotka ovat TÄMÄLLE roolille read-only.
   * Jos polku täsmää sekä allowedPaths että readOnlyPaths → vain luku, ei kirjoitusta.
   */
  readOnlyPaths: string[];
}

/**
 * Tärkein pointti:
 * - coder saa muokata koodia + docs + README
 * - documenter saa lukea koodia, mutta muokata vain README + docs
 */
export const roleAccessConfig: Record<AgentRole, RoleAccessRule> = {
  coder: {
    allowedPaths: [
      "**/src/**",
      "**/tests/**",
      "**/docs/**",
      "**/README.md",
      "**/*.md",      // muut juuren md-tiedostot
    ],
    readOnlyPaths: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.git/**",
      "**/migrations/**",
      "**/prisma/migrations/**",
      // HUOM: EI src/** eikä docs/** eikä README.md → coder saa muokata niitä
    ],
  },

  documenter: {
    allowedPaths: [
      "**/src/**",        // saa lukea koodia
      "**/docs/**",       // saa luoda/muokata dokkareita
      "**/README.md",     // saa luoda/muokata juuren README:tä
      "**/*.md",          // muut juuren md-tiedostot
    ],
    readOnlyPaths: [
      "**/src/**",        // koodi vain luettavaksi
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.git/**",
      "**/migrations/**",
      "**/prisma/migrations/**",
    ],
  },
};
