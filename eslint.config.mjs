import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        files: ['src/**/*.ts'],
        extends: [...tseslint.configs.recommended],
    },
    {
        ignores: ['**/dist/', 'dist-tsc/', 'node_modules/'],
    },
);
