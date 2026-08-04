import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	extractCustomHeaders,
	extractMethod,
	extractToken,
	extractUrl,
} from '../extractors';
import { buildCurl } from '../curlBuilder';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('parses PrettyDioLogger requests and wrapped headers', () => {
		const log = `I/flutter ( 8663): ╔╣ Request ║ GET
I/flutter ( 8663): ║  https://example.test/api/items?page=1
I/flutter ( 8663): ╚════════════════════════════════════╝
I/flutter ( 8663): ╔ Headers
I/flutter ( 8663): ╟ Content-Type: application/json
I/flutter ( 8663): ╟ Authorization:
I/flutter ( 8663): ║ Bearer abc.def
I/flutter ( 8663): ║ .ghi
I/flutter ( 8663): ╟ X-Access-Api:
I/flutter ( 8663): ║ first_part
I/flutter ( 8663): ║ _second_part
I/flutter ( 8663): ╟ lang: ar
I/flutter ( 8663): ╔╣ Request ║ GET
I/flutter ( 8663): ║  https://example.test/api/other`;

		assert.strictEqual(extractMethod(log), 'GET');
		assert.strictEqual(extractUrl(log), 'https://example.test/api/items?page=1');
		assert.strictEqual(extractToken(log), 'abc.def.ghi');
		const headers = extractCustomHeaders(log);
		assert.deepStrictEqual(headers, [
			{ key: 'Content-Type', value: 'application/json' },
			{ key: 'Authorization', value: 'Bearer abc.def.ghi' },
			{ key: 'X-Access-Api', value: 'first_part_second_part' },
			{ key: 'lang', value: 'ar' },
		]);

		const curl = buildCurl({
			url: extractUrl(log)!,
			method: extractMethod(log)!,
			token: extractToken(log),
			body: null,
			customHeaders: headers,
		});
		assert.ok(curl.includes('--request GET'));
		assert.ok(curl.includes('--header "Authorization: Bearer abc.def.ghi"'));
		assert.ok(curl.includes('--header "X-Access-Api: first_part_second_part"'));
		assert.strictEqual((curl.match(/Authorization:/g) ?? []).length, 1);
	});
});
