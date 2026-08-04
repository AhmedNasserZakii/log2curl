import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	extractCustomHeaders,
	extractMethod,
	extractToken,
	extractUrl,
} from '../extractors';
import { buildCurl, shellQuote } from '../curlBuilder';
import { buildCurlFromDraft } from '../curlBuilder';
import { isolateFirstRequest, parseLogToRequestDraft } from '../requestParser';
import { isSensitiveHeader } from '../requestStudio/model';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('matches complete cURL regression fixtures', () => {
		const fixtureDirectory = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
		for (const fixture of ['pretty-dio-multiple', 'json-post']) {
			const log = fs.readFileSync(path.join(fixtureDirectory, `${fixture}.log`), 'utf8');
			const expected = fs.readFileSync(
				path.join(fixtureDirectory, `${fixture}.curl`), 'utf8'
			).trimEnd();
			const parsed = parseLogToRequestDraft(log);
			assert.strictEqual(parsed.ok, true, `${fixture} should parse`);
			if (!parsed.ok) { continue; }
			assert.strictEqual(
				buildCurlFromDraft(parsed.draft, { legacyDefaults: true }),
				expected
			);
		}

		const malformed = fs.readFileSync(
			path.join(fixtureDirectory, 'malformed.log'), 'utf8'
		);
		assert.strictEqual(parseLogToRequestDraft(malformed).ok, false);
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
		assert.ok(curl.includes("--header 'Authorization: Bearer abc.def.ghi'"));
		assert.ok(curl.includes("--header 'X-Access-Api: first_part_second_part'"));
		assert.strictEqual((curl.match(/Authorization:/g) ?? []).length, 1);
	});

	test('creates an editable request draft without leaking the next request', () => {
		const log = `I/flutter ( 10): ╔╣ Request ║ GET
I/flutter ( 10): ║ https://example.test/items?tag=one&tag=two&page=1
I/flutter ( 10): ╚════════════════════════════════════╝
I/flutter ( 10): ╔ Headers
I/flutter ( 10): ╟ Authorization:
I/flutter ( 10): ║ Bearer fake.first
I/flutter ( 10): ║ .token
I/flutter ( 10): ╟ X-Api-Key: fake-key
I/flutter ( 10): ╔╣ Request ║ DELETE
I/flutter ( 10): ║ https://example.test/items/2`;

		const isolated = isolateFirstRequest(log);
		assert.strictEqual(isolated.requestCount, 2);
		assert.ok(!isolated.text.includes('/items/2'));

		const result = parseLogToRequestDraft(log);
		assert.strictEqual(result.ok, true);
		if (!result.ok) { return; }
		assert.strictEqual(result.draft.method, 'GET');
		assert.strictEqual(result.draft.url, 'https://example.test/items');
		assert.deepStrictEqual(
			result.draft.query.map(pair => [pair.name, pair.value]),
			[['tag', 'one'], ['tag', 'two'], ['page', '1']]
		);
		assert.strictEqual(
			result.draft.headers.find(header => header.name === 'Authorization')?.value,
			'Bearer fake.first.token'
		);
		assert.ok(result.warnings.some(warning => warning.code === 'multiple-requests'));
		const curl = buildCurlFromDraft(result.draft);
		assert.ok(curl.includes('tag=one&tag=two&page=1'));
		assert.ok(!curl.includes('/items/2'));
	});

	test('marks common credential headers as sensitive', () => {
		assert.strictEqual(isSensitiveHeader('Authorization'), true);
		assert.strictEqual(isSensitiveHeader('X-Api-Key'), true);
		assert.strictEqual(isSensitiveHeader('Cookie'), true);
		assert.strictEqual(isSensitiveHeader('Content-Type'), false);
	});

	test('imports and normalizes a JSON POST body', () => {
		const result = parseLogToRequestDraft(`Method: POST
FULL URL: https://example.test/orders
HEADERS:
Content-Type: application/json
X-Trace: fake-trace
REQUEST BODY/DATA:
{customer: Ahmed, quantity: 2}`);
		assert.strictEqual(result.ok, true);
		if (!result.ok) { return; }
		assert.strictEqual(result.draft.method, 'POST');
		assert.strictEqual(result.draft.body.mode, 'json');
		assert.deepStrictEqual(JSON.parse(result.draft.body.text), {
			customer: 'Ahmed', quantity: 2,
		});
	});

	test('returns structured diagnostics for malformed input', () => {
		const result = parseLogToRequestDraft('TRACE somewhere without a URL');
		assert.strictEqual(result.ok, false);
		if (result.ok) { return; }
		assert.ok(result.errors.some(error => error.code === 'url-missing'));
		assert.ok(result.errors.some(error => error.code === 'method-missing'));
	});

	test('omits disabled rows and avoids case-insensitive default header duplicates', () => {
		const parsed = parseLogToRequestDraft('Method: GET\nFULL URL: https://example.test/items');
		assert.strictEqual(parsed.ok, true);
		if (!parsed.ok) { return; }
		parsed.draft.query.push(
			{ id: 'on', name: 'visible', value: 'yes', enabled: true },
			{ id: 'off', name: 'hidden', value: 'no', enabled: false }
		);
		parsed.draft.headers.push(
			{ id: 'accept', name: 'accept', value: 'text/plain', enabled: true },
			{ id: 'disabled', name: 'X-Hidden', value: 'secret', enabled: false }
		);
		const curl = buildCurlFromDraft(parsed.draft);
		assert.ok(curl.includes('visible=yes'));
		assert.ok(!curl.includes('hidden=no'));
		assert.strictEqual((curl.match(/Accept:/gi) ?? []).length, 1);
		assert.ok(!curl.includes('X-Hidden'));
	});

	test('Request Studio cURL exactly mirrors draft and executor defaults', () => {
		const parsed = parseLogToRequestDraft('Method: GET\nFULL URL: https://example.test/items');
		assert.strictEqual(parsed.ok, true);
		if (!parsed.ok) { return; }
		const getCurl = buildCurlFromDraft(parsed.draft);
		assert.ok(!getCurl.includes('Accept:'));
		assert.ok(!getCurl.includes('Content-Type:'));

		parsed.draft.method = 'POST';
		parsed.draft.body = { mode: 'json', text: '{"ok":true}' };
		const postCurl = buildCurlFromDraft(parsed.draft);
		assert.ok(postCurl.includes("--header 'Content-Type: application/json'"));
		assert.ok(postCurl.includes("--data '{\"ok\":true}'"));
		assert.ok(!postCurl.includes('Accept:'));
	});

	test('shell-quotes URLs, headers, and bodies without interpolation', () => {
		assert.strictEqual(shellQuote("a'b"), "'a'\"'\"'b'");
		const curl = buildCurl({
			url: 'https://example.test/items?q=$(touch%20bad)',
			method: 'POST',
			token: null,
			body: JSON.stringify({ value: "it's $HOME `whoami`" }),
			customHeaders: [{ key: 'X-Test', value: "a'b; $(bad)" }],
		});
		assert.ok(curl.includes("'https://example.test/items?q=$(touch%20bad)'"));
		assert.ok(curl.includes("--header 'X-Test: a'\"'\"'b; $(bad)'"));
		assert.ok(curl.includes("it'\"'\"'s $HOME `whoami`"));
	});
});
