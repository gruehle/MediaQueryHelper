/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true,  regexp: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, window, _rescanDoc, queriesInDocument */

define(function (require, exports, module) {
    "use strict";
    
    var AppInit             = brackets.getModule("utils/AppInit"),
        Async               = brackets.getModule("utils/Async"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        FileIndexManager    = brackets.getModule("project/FileIndexManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        StringUtils         = brackets.getModule("utils/StringUtils"),
        TextRange           = brackets.getModule("document/TextRange").TextRange;
    
    var documents = [],         // CSS documents in project
        queries = [],           // Media queries in project
        hasUnterminated = {};   // Docs that have unterminated queries
    
    var mediaQueryRegEx = /^[ \t]*(@media\s+([^\{]*))\{/mg;
    
    var MAX_VALUE = 10000; // Arbitrarily large max width
    
    // MediaQuery
    // This object represents a media query entry in a CSS file
    function MediaQuery(doc, startLine, endLine, minValue, maxValue, queryText) {
        var _textRange = new TextRange(doc, startLine, endLine),
            _minValue = minValue,
            _maxValue = maxValue,
            _queryText = queryText;

        $(_textRange).on("lostSync", function () {
            _rescanDoc(_textRange.document);
        });
        
        return {
            textRange: _textRange,
            minValue: _minValue,
            maxValue: _maxValue,
            queryText: _queryText,
            dispose: function () {
                _textRange.dispose();
            },
            matches: function (width) {
                return width >= _minValue && width <= _maxValue;
            },
            closeness: function (width) {
                return Math.min(
                    _minValue === 0 ? MAX_VALUE : Math.abs(width - _minValue),
                    _maxValue === MAX_VALUE ? MAX_VALUE : Math.abs(_maxValue - width)
                );
            }
        };
    }
    
    /**
     * Remove all query entries for the specified document
     */
    function _removeDocEntries(doc) {
        queries = queries.filter(function (query) {
            if (query.textRange.document === doc) {
                query.dispose();
                return false;
            }
            
            return true;
        });
        
        delete hasUnterminated[doc.file.fullPath];
    }
    
    /**
     * Scan a document and extract all media queries
     */
    function _scanDoc(doc) {
        // Find all matching media queries for the given CSS file's content, and add them to the
        // overall search result
        var text = doc.getText();
        
        if (text.indexOf("@media") !== -1) {
            var match;
            
            while ((match = mediaQueryRegEx.exec(text)) !== null) {
                // For now we only look for min-width and max-width 
                var minWidthMatch = /min-width\s*\:\s*([0-9]*)/.exec(match[2]),
                    maxWidthMatch = /max-width\s*\:\s*([0-9]*)/.exec(match[2]);
                
                
                if (minWidthMatch || maxWidthMatch) {
                    var endOffset = match.index + match[0].length + 1,
                        braceCount = 1,
                        startLine,
                        endLine,
                        minValue,
                        maxValue;
                    
                    // Scan forward until we reach a matching close brace
                    while (braceCount && endOffset < text.length) {
                        if (text[endOffset] === "{") {
                            braceCount++;
                        } else if (text[endOffset] === "}") {
                            braceCount--;
                        }
                        endOffset++;
                    }
                    
                    // If we don't have matching braces, mark this doc as having unterminated queries
                    // NOTE: we don't handle braces in comments, so this "unterminated" mark may be
                    // a false positive
                    if (braceCount > 0) {
                        hasUnterminated[doc.file.fullPath] = true;
                    }
                    
                    startLine = StringUtils.offsetToLineNum(text, match.index);
                    endLine = StringUtils.offsetToLineNum(text, endOffset);
                    minValue = minWidthMatch ? Number(minWidthMatch[1]) : 0;
                    maxValue = maxWidthMatch ? Number(maxWidthMatch[1]) : MAX_VALUE; // Arbitrarily large max width

                    queries.push(new MediaQuery(doc, startLine, endLine, minValue, maxValue, match[1]));
                }
            }
        }
    }
    
    /**
     * Re-scan a document
     */
    function _rescanDoc(doc) {
        _removeDocEntries(doc);
        _scanDoc(doc);
    }
    
    function _rangeIsInMediaQuery(doc, from, to) {
        var i, allQueries = queriesInDocument(doc);
        
        for (i = 0; i < allQueries.length; i++) {
            var query = allQueries[i],
                startLine = query.textRange.startLine,
                endLine = query.textRange.endLine;
            
            if ((from.line <= startLine && to.line >= startLine) ||
                    (from.line <= endLine && to.line >= endLine)) {
                return true;
            }
        }
        
        return false;
    }
    
    function _documentChangeHandler(event, doc, changeList) {
        // If any of the following changes happen, rescan the document:
        //  1. Changes to any lines that start with "@media"
        //  2. *Any* changes in a document that have non-terminated media queries
        //  3. Wholesale changes to the document
        
        var change = changeList,
            rescanDoc = false,
            lineNum;
        
        // If doc has unterminated @media queries, rescan and exit
        if (hasUnterminated[doc.file.fullPath]) {
            // console.log("doc has unterminated queries");
            _rescanDoc(doc);
            return;
        }
        
        while (change) {
            // If from && to are undefined, the change is wholesale
            if (!change.from && !change.to) {
                rescanDoc = true;
                break;
            }
            
            // If the change is in the first or last line of a media query, rescan
            if (_rangeIsInMediaQuery(doc, change.from, change.to)) {
                // console.log("change modified a media query");
                rescanDoc = true;
                break;
            }
            
            var text = doc.getRange(
                {line: change.from.line, ch: 0},
                {line: change.to.line + 1, ch: 0}
            );
            
            // If the changed range has "@media", rescan
            if (text.search(mediaQueryRegEx) !== -1) {
                // console.log("changed text line has @media");
                rescanDoc = true;
                break;
            }
            
            // If the new text has a media query, rescan
            if (change.text.join("\n").search(mediaQueryRegEx) !== -1) {
                // console.log("new text has media query");
                rescanDoc = true;
                break;
            }
            
            change = change.next;
        }
        
        if (rescanDoc) {
            // console.log("rescanning for media queries: " + doc.file.fullPath);
            _rescanDoc(doc);
        }
    }
    
    function _documentDeletedHandler(event) {
        var deletedDoc = event.target;
        
        _removeDocEntries(deletedDoc);
        documents = documents.filter(function (doc) {
            return deletedDoc !== doc;
        });
    }
    
    // Called before a project is closed.
    function _onBeforeProjectClose() {
        // Remove old doc change handlers and references
        documents.forEach(function (doc) {
            $(doc).off("change", _documentChangeHandler);
            $(doc).off("deleted", _documentDeletedHandler);
            doc.releaseRef();
        });
        documents = [];
        
        // Release old queries
        queries.forEach(function (query) {
            query.dispose();
        });
        queries = [];
        hasUnterminated = {};
    }
    
    // Called when a new project is opened
    function _onProjectOpen() {
        function _loadFileAndScan(fullPath) {
            var oneFileResult = new $.Deferred();
            
            DocumentManager.getDocumentForPath(fullPath)
                .done(function (doc) {
                    $(doc).on("change", _documentChangeHandler);
                    $(doc).on("deleted", _documentDeletedHandler);
                    doc.addRef();
                    documents.push(doc);
                    _scanDoc(doc);
                    oneFileResult.resolve();
                })
                .fail(function (error) {
                    oneFileResult.reject(error);
                });
        
            return oneFileResult.promise();
        }
        
        // _onBeforeProjectClosed should have been called by now
        console.assert(documents.length === 0, "MediaQueryUtils: Old documents still around.");
        console.assert(queries.length === 0, "MediaQueryUtils: Old queries still around.");
        
        FileIndexManager.getFileInfoList("css").done(function (fileInfos) {
            Async.doInParallel(fileInfos, function (fileInfo, number) {
                return _loadFileAndScan(fileInfo.fullPath);
            });
        });
    }
    
    /**
     * Return a list of all media queries in the project that match
     * the specified width.
     * @param {number} width Width to use for matching queries
     * @return {Array.<MediaQuery>} Queries that match the specified width. Returns
     *          an emtpy array if there are no matches in the project.
     */
    function findAllMatches(width) {
        var matches = [];
        
        queries.forEach(function (query) {
            if (query.matches(width)) {
                matches.push(query);
            }
        });
        
        return matches;
    }
    
    /**
     * Finds the media query that has the closest match to the specified width.
     * @param {number} width Width to use for matching queries
     * @return {MediaQuery} Query with the closest match. Returns NULL if no
     *        matches are found.
     */
    function findClosestMatch(width) {
        var allMatches = findAllMatches(width), closest;
        
        allMatches.forEach(function (query) {
            if (!closest) {
                closest = query;
            } else {
                if (query.closeness(width) < closest.closeness(width)) {
                    closest = query;
                }
            }
        });
        
        return closest;
    }
    
    /**
     * Returns the media query at the specified document position
     * @param {string} fullPath Full path of the document
     * @param {{line: number, ch:number}} pos Position within document
     * @return {MediaQuery} Media query at the specified position. Returns
     *       NULL if there are no queries at the specified position.
     */
    function queryAtDocumentPosition(fullPath, pos) {
        var i;
        
        for (i = 0; i < queries.length; i++) {
            var query = queries[i];
            if (query.textRange.document.file.fullPath === fullPath) {
                if (pos.line >= query.textRange.startLine &&
                        pos.line <= query.textRange.endLine) {
                    return query;
                }
            }
        }
        
        return null;
    }
    
    function queriesInDocument(doc) {
        var result = [];
        
        queries.forEach(function (query) {
            if (query.textRange.document.file.fullPath === doc.file.fullPath) {
                result.push(query);
            }
        });
        
        return result;
    }
    
    $(ProjectManager).on("beforeProjectClose", _onBeforeProjectClose);
    $(ProjectManager).on("projectOpen", _onProjectOpen);
    
    exports.findAllMatches = findAllMatches;
    exports.findClosestMatch = findClosestMatch;
    exports.queryAtDocumentPosition = queryAtDocumentPosition;
    exports.queriesInDocument = queriesInDocument;
});
