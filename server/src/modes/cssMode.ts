// https://github.com/microsoft/vscode-extension-samples/blob/main/lsp-embedded-language-service/server/src/modes/cssMode.ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageService as CSSLanguageService, Stylesheet } from 'vscode-css-languageservice';
import { HTMLDocumentRegions } from '../embeddedSupport';
import { LanguageModelCache } from '../languageModelCache';
import { LanguageMode, Position } from '../languageModes';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function getCSSMode(
	cssLanguageService: CSSLanguageService,
	documentRegions: LanguageModelCache<HTMLDocumentRegions>
): LanguageMode & {
	getId(): "css"
	parseStylesheet(doc: TextDocument): Stylesheet
	getEmbeddedDocument(doc: TextDocument): TextDocument
} {
	function parseStylesheet (embeddedDocument: TextDocument) {
		return cssLanguageService.parseStylesheet(embeddedDocument);
	}
	function getEmbeddedDocument (document: TextDocument) {
		// Get virtual CSS document, with all non-CSS code replaced with whitespace
		return documentRegions.get(document).getEmbeddedDocument('css');
	}

	return {
		getId(): "css" {
			return 'css';
		},
		doValidation(document: TextDocument) {
			const embeddedDocument = getEmbeddedDocument(document)
			const stylesheet = parseStylesheet(embeddedDocument)
			return cssLanguageService.doValidation(embeddedDocument, stylesheet);
		},
		parseStylesheet(embeddedDocument: TextDocument) { return parseStylesheet(embeddedDocument) },
		getEmbeddedDocument (document: TextDocument) { return getEmbeddedDocument(document) },
		doComplete(document: TextDocument, position: Position) {
			// Get virtual CSS document, with all non-CSS code replaced with whitespace
			const embeddedDocument = getEmbeddedDocument(document)
			const stylesheet = parseStylesheet(embeddedDocument)
			return cssLanguageService.doComplete(embeddedDocument, position, stylesheet);
		},
		onDocumentRemoved(_document: TextDocument) { /* nothing to do */ },
		dispose() { /* nothing to do */ }
	};
}
