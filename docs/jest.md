# Jest and React Native

This guide covers CommonJS Jest projects using `@swc/jest`, including the migration errors reported in [#26](https://github.com/songkeys/tsconfig-to-swcconfig/issues/26). Converting tsconfig does not configure Jest's mocks or replace Babel plugins.

## Spying on module exports

SWC emits getters for ES module exports. Calling `jest.spyOn` on these exports can throw `Cannot redefine property: default`. Create a module mock first:

```typescript
import * as useHookMock from './useHook'

jest.mock('./useHook', () => ({
  __esModule: true,
  ...jest.requireActual('./useHook'),
}))

it('uses the mocked hook', () => {
  jest.spyOn(useHookMock, 'default').mockReturnValue('mocked')
  expect(useHookMock.default()).toBe('mocked')
})
```

This copies the exports into a mock object that Jest can modify. It does not change the original module's exports. See the [SWC discussion](https://github.com/swc-project/swc/discussions/7024).

## React Native transforms

Keep React Native's Jest preset and Babel configuration for its dependencies. Apply SWC only to application files that do not need Babel plugins. In this example, those files live under `src/`; narrow that directory if your app contains native component specs or Reanimated worklets that still require Babel.

```javascript
// jest.config.cjs
const path = require('node:path')
const preset = require('@react-native/jest-preset')
const { convert } = require('tsconfig-to-swcconfig')

const sourceRoot = (path.join(__dirname, 'src') + path.sep).replace(
  /[.*+?^${}()|[\]\\]/g,
  '\\$&',
)

module.exports = {
  ...preset,
  transform: {
    [`^${sourceRoot}.*\\.tsx?$`]: [
      '@swc/jest',
      convert('tsconfig.json', __dirname, {
        module: { type: 'commonjs', noInterop: false },
        jsc: { transform: { react: { runtime: 'automatic' } } },
      }),
    ],
    ...preset.transform,
  },
  setupFiles: [...preset.setupFiles, '<rootDir>/jest.setup.js'],
}
```

Jest uses the first matching transform, so the application rule goes before the preset's Babel rule. The JSX override is needed when tsconfig uses `jsx: "react-native"` or `"preserve"`, which leave JSX intact. Keep any existing setup files and transform exclusions when adapting this example.

Use the preset matching your React Native version. Older releases expose it as `require('react-native/jest-preset')`. Keep your existing Babel plugins; a minimal Babel configuration for current React Native is:

```javascript
// babel.config.cjs
module.exports = {
  presets: ['module:@react-native/babel-preset'],
}
```

## WebView in unit tests

Mock the native component before importing application code that uses it. This avoids loading WebView's native implementation or passing its compiled component spec through Babel Codegen during unit tests:

```javascript
// jest.setup.js
jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual('react-native')
  return { __esModule: true, default: View, WebView: View }
})
```

Both `import WebView from 'react-native-webview'` and `import { WebView } from 'react-native-webview'` are supported. This mock supports tests of the surrounding component; tests of WebView-specific methods or events need a mock that models those behaviors. See [Jest's React Native guide](https://jestjs.io/docs/tutorial-react-native#mock-native-modules-using-jestmock).

## `DIRECTIONS is not defined`

The report does not include the declaration or resolved file, so its cause is still unconfirmed. A normal enum creates a runtime value; a `declare enum` or `.d.ts` file does not. Check the file Jest actually resolves and make sure imports and path mappings target the implementation rather than a declaration file.

Continue running TypeScript's type checker with `isolatedModules: true` to catch constructs that need whole-program compilation, such as references to ambient const enums. SWC compiles one file at a time; see its [TypeScript migration guide](https://swc.rs/docs/migrating-from-tsc#isolatedmodules-true).
