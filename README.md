# soap-journal-mobile

Offline, single-user SOAP journaling app with a built-in Bible reader (Capacitor +
React + TypeScript, Android target). See `docs/` for architecture, schema, and the
TS-porting plan.

## Building the prebuilt Bible asset

The app ships a prebuilt SQLite database (Bible text populated, journal tables empty)
that is copied into place on first launch. It is **not** committed — it's a build
artifact produced from canonical JSONs that are generated out-of-band:

1. Generate the 13 public-domain canonical JSONs with the server repo's
   `build-translation` command (one `.json` per translation).
2. Drop them in `bibles-canonical/` (gitignored).
3. Run `npm run build-bible-db` — validates each file against the canonical schema and
   emits `public/assets/databases/soapjournal.db` (a malformed file fails loudly and
   writes nothing).
4. `npm run build` then `npx cap sync android` carry the asset into the Android project
   (`public/` → `dist/` → Android assets). The app opens it as
   `createConnection("soapjournal")`.

`bibles-canonical/` (inputs) and `public/assets/databases/` (the asset) are both
gitignored. This build step is an operational task, not part of the test suite (it needs
the real translation JSONs).

## Building the Android app

The native Android build (Capacitor 8) **requires JDK 21** — Gradle fails with
`invalid source release: 21` on JDK 17. The Android SDK must also be available
(`ANDROID_HOME` or `android/local.properties` → `sdk.dir`).

Point Gradle at a JDK 21 once, so you never have to export `JAVA_HOME` per build, by
adding it to your **user-global** `~/.gradle/gradle.properties` (never committed):

```properties
org.gradle.java.home=/absolute/path/to/jdk-21
```

(`android/gradle.properties` is committed by Capacitor and holds shared build flags, so a
machine-specific JDK path belongs in `~/.gradle/gradle.properties`, not there. Exporting
`JAVA_HOME=/path/to/jdk-21` per shell also works.) No JDK 21 installed? A portable
Temurin 21 tarball extracted anywhere works — point `org.gradle.java.home` at it.

Then, with the prebuilt asset in place (above):

```bash
npm run build && npx cap sync android      # carry web + DB asset into the native project
npx cap run android                         # build, install, launch on a connected device
```

---

This project was bootstrapped from the React + TypeScript + Vite template.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
