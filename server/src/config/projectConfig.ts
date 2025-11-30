// src/config/projectConfig.ts
import path from "path";

export const PROJECT_ROOT = path.resolve(
    process.env.AGENT_PROJECT_ROOT ?? process.cwd()
);

export type AgentRole = "planner" | "coder" | "tester" | "critic" | "documenter";

export interface FileAccessConfig {
    rootDir: string;
}

export const fileAccessConfig: FileAccessConfig = {
    rootDir: PROJECT_ROOT,
};

// Per-rooli file policy
export interface RoleFilePolicy {
    allowedPaths: string[];   // mihin saa koskea
    readOnlyPaths: string[];  // minne EI saa kirjoittaa
}

export const roleFilePolicies: Record<AgentRole, RoleFilePolicy> = {
    planner: {
        allowedPaths: [],       // ei mitään, planner ei koske tiedostoihin
        readOnlyPaths: [],
    },
    coder: {
        allowedPaths: ["src/", "tests/", "playground/"],
        readOnlyPaths: ["node_modules/", ".git/"],
    },
    tester: {
        allowedPaths: ["src/", "tests/"],
        readOnlyPaths: ["src/", "tests/"], // saa lukea, ei kirjoittaa
    },
    critic: {
        allowedPaths: ["src/", "tests/"],
        readOnlyPaths: ["src/", "tests/"],
    },
    documenter:{
        allowedPaths:["src/", "docs/"],
        readOnlyPaths:["src/"],
    }
};
