// src/config/projectConfig.ts
import path from "path";

export const PROJECT_ROOT = path.resolve(
    process.env.AGENT_PROJECT_ROOT ?? process.cwd()
);

export type AgentRole =
    | "planner"
    | "coder"
    | "tester"
    | "critic"
    | "documenter";

export interface FileAccessConfig {
    rootDir: string;
}

export const fileAccessConfig: FileAccessConfig = {
    rootDir: PROJECT_ROOT,
};

export interface RoleAccessRule {
    allowedPaths: string[];
    readOnlyPaths: string[];
}

export const roleAccessConfig: Record<AgentRole, RoleAccessRule> = {
    planner: {
        // suunnittelu: saa katsella lähes kaikkea, mutta ei kirjoita
        allowedPaths: ["src/", "tests/", "docs/"],
        readOnlyPaths: ["src/", "tests/", "docs/"],
    },
    coder: {
        // varsinainen koodariagentti
        allowedPaths: ["src/", "tests/", "docs/"],
        readOnlyPaths: ["docs/"],
    },
    tester: {
        allowedPaths: ["src/", "tests/"],
        readOnlyPaths: ["src/", "tests/"], // lukee ja ajaa testejä, ei muuta koodia
    },
    critic: {
        allowedPaths: ["src/", "tests/"],
        readOnlyPaths: ["src/", "tests/"],
    },
    documenter: {
        allowedPaths: ["src/", "docs/"],
        readOnlyPaths: ["src/"], // saa muokata docsia, ei koodia
    },
};
