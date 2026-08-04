import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Keep release tests reproducible and aligned with engines.vscode.
	version: '1.105.1',
});
