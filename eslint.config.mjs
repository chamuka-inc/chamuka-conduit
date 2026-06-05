import tseslint from 'typescript-eslint'

// Flat config. The smell rules from ENGINEERING_DISCIPLINE.md (TS addendum) that need no
// type information are enforced here; type-aware rules (e.g. no-floating-promises) are added
// in packages that contain async runtime logic (core/app), where the project service is wired.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.next/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
