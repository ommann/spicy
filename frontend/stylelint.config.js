export default {
  rules: {
    'color-no-invalid-hex': true,
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i],
    'declaration-block-no-duplicate-properties': true,
    'no-duplicate-selectors': true,
  },
  overrides: [{
    files: ['src/theme.css'],
    rules: { 'color-no-hex': null, 'color-named': null, 'function-disallowed-list': null },
  }],
};
