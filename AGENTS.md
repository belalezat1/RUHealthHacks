# Project instructions

Use the TypeSafe skill at `.agents/skills/typesafe-ai/SKILL.md` when working on this project's AI features. The chosen model family is Jev. Read the current TypeSafe documentation before implementing integrations.

Keep eligibility rules, calculations, and approval requirements in code. Use Jev for semantic judgments where useful.

Store the local API key in the root `.env` as `TYPESAFE_API_KEY`. Keep credentials server-side and out of Git. The backend must load this file or receive the variable through its runtime environment; the SDK reads the environment variable, not the file itself.
