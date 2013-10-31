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
/*global define, brackets, $, window, PathUtils */

// TODO:
//  X focus
//  X scroll position
//  scroll bug when selecting query
//  X initial preview file
//  X icon
//  make sure extra work is only done when extension is active
//  unit tests
//  X disable iframe clicks/focus/keyboard events
//  enabled state prefs
//  localize
//  ---
//  add dropdown to anchor, list matches in closeness order
//  handle comments when parsing for media queries - need test cases first
//  be more robust when loading iframe content - need test cases
// DONE:
//  X horizontal scroll
//  X Support min-width and max-width
//  X Layout of scaled iframe
//  X status bar
//  X load sizes from config file
//  X query object
//  X CSS editing
//   X edit range of existing query
//   X obliterate query
//   X add new query
//   X edit query params
//   X undo for the above
//

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var AppInit             = brackets.getModule("utils/AppInit"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        Commands            = brackets.getModule("command/Commands"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        LiveDevelopment     = brackets.getModule("LiveDevelopment/LiveDevelopment"),
        Menus               = brackets.getModule("command/Menus"),
        PopUpManager        = brackets.getModule("widgets/PopUpManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager");
    
    // Extension modules
    var MediaQueryModel     = require("MediaQueryUtils");
    
    // Templates
    var config              = JSON.parse(require("text!preview-config.json"));
    
    // Preview file (relative to project root)
    var previewFile = "index.html";
    var previewFileFound = false;
    
    // Status message holder
    var $status = $("<div id='media-query-status'>");
    
    // Main preview holder
    var $preview = $("<div id='media-query-preview'>");
    
    // "Can't find index.html" message
    var $message;

    // Toolbar icon
    var $icon;
    
    // Query list dropdown
    var $dropdown;
    
    // Create the preview thumbnails
    var PADDING = 20;
    var xPos = PADDING / 2;
    config.sizes.forEach(function (size) {
        var scaledWidth = Math.round(size * config.scale);
        
        var $iframe = $("<iframe>")
            .attr({
                width: size,
                height: 600 * 0.3 / config.scale,
                sandbox: "allow-scripts allow-same-origin",
                seamless: true,
                "tab-index": -1
            })
            .css({
                "-webkit-transform": "scale(" + config.scale + ")"
            });
        
        var $thumbnail = $("<div class='preview-holder'>")
            .css({
                left: xPos,
                width: scaledWidth
            })
            .append($iframe)
            .append($("<a class='size-link no-focus' href='#'>" + size + "px</a>"));
        
        $preview.append($thumbnail);
        
        xPos += (scaledWidth + PADDING);
    });
    
    // Add label click handlers to find and open the nearest match
    $preview.find("a").click(function (e) {
        var width = /[0-9]*/.exec(e.target.innerText)[0],
            $target = $(e.target);
            
        var queryList = MediaQueryModel.findAllMatches(width),
            _hideDropdown = function () {
                if ($dropdown) {
                    $dropdown.remove();
                    $dropdown = null;
                    $(window.document).off("mousedown", _hideDropdown);
                }
            };
        
        _hideDropdown();
        
        if (queryList && queryList.length) {
            // Sort the list by closeness
            queryList.sort(function (a, b) {
                if (a.closeness(width) < b.closeness(width)) {
                    return -1;
                } else {
                    return 1;
                }
            });

            // Make a dropdown
            $dropdown = $("<ul class='dropdown-menu'>");
            
            var _queryClickHandler = function (e) {
                var $target = $(e.currentTarget),
                    query = $target.data("query");
                
                _hideDropdown();
                
                if (query) {
                    CommandManager.execute(Commands.FILE_OPEN, {fullPath: query.textRange.document.file.fullPath})
                        .done(function (doc) {
                            // Opened document is now the current main editor
                            EditorManager.getCurrentFullEditor().setSelection(
                                {line: query.textRange.startLine, ch: 0},
                                {line: query.textRange.endLine + 1, ch: 0},
                                true
                            );
                            
                            // Highlight the doc in the project tree
                            CommandManager.execute(Commands.NAVIGATE_SHOW_IN_FILE_TREE);
                            
                            // Ugh. Focus is being stolen from the editor. Restore it on a timeout.
                            // TODO: Figure out why this is happening and remove this hack!
                            window.setTimeout(function () {
                                EditorManager.focusEditor();
                            }, 0);
                        });
                }
            };
            
            queryList.forEach(function (query) {
                var item = $("<li><a href='#'>"
                             + query.queryText
                             + "<span class='query-related-file'>"
                             + query.textRange.document.file.name
                             + " : "
                             + query.textRange.startLine
                             + "</spen></a>")
                        .data("query", query)
                        .on("mousedown", _queryClickHandler)
                        .appendTo($dropdown);
            });
            
            var $dropdownTarget = $target.closest(".preview-holder"),
                DROPDOWN_WIDTH = 400;
            $dropdown
                .css({
                    "min-width": DROPDOWN_WIDTH,
                    left: $dropdownTarget.position().left - ((DROPDOWN_WIDTH - $dropdownTarget.outerWidth()) / 2),
                    top: $dropdownTarget.position().top + $dropdownTarget.outerHeight() + 5
                })
                .appendTo($preview.parent())
                .show();
            
            PopUpManager.addPopUp($dropdown, _hideDropdown, true);
            //$(window.document).on("mousedown", _hideDropdown);
        }
    });
    
    // Add preview toolbar above editor area
    $preview.hide().insertBefore("#editor-holder");

    // Highlight thumbnail for media selector being edited
    var _editor; // Editor whose cursor we are tracking
    
    function indicateActiveMediaQuery() {
        // Remove all existing highlights and status
        $("#media-query-preview iframe").attr("class", "");
        $status.text("");
        
        if (!_editor) {
            return;
        }
        
        var query = MediaQueryModel.queryAtDocumentPosition(
            _editor.document.file.fullPath,
            _editor._codeMirror.getCursor(true)  // Cant use Editor.getCursorPos() because we want the start pos
        );
        
        if (query) {
            config.sizes.forEach(function (size) {
                $("iframe[width=" + size + "]").addClass(query.matches(size) ? "highlighted" : "dimmed");
            });
            
            $status.text(query.queryText);
        }
    }
    
    // State properties
    var enabled = false;
    var previewDocumentPath;
    
    // Load the preview document into the iframes. For now we look for "index.html"
    // in the root of the project directory. We will need to do something smarter
    // than this...
    function loadContent(force) {
        if (enabled) {
            if ($message) {
                $message.remove();
                $message = null;
            }

            if (previewFileFound && !force) {
                var $iframes = $preview.find("iframe");
                
                // Can't just compare src with previewDocumentPath since src may have "file://localhost" prepended
                if ($iframes[0].src.indexOf(previewDocumentPath) !== -1) {
                    $iframes.each(function (index, frame) {
                        frame.contentWindow.location.reload(true);
                    });
                } else {
                    var count = $iframes.length;
                    
                    $iframes.attr("src", previewDocumentPath);
                    
                    $iframes.load(function () {
                        function preventEvent(e) {
                            e.stopImmediatePropagation();
                            e.preventDefault();
                        }
                        if (--count === 0) {
                            $iframes.contents().each(function (idx, item) {
                                // Disable mouse and keyboard events
                                ["mouseover", "mouseout", "mousedown", "mouseup", "mousemove", "click", "dblclick", "keydown", "keyup", "keypress"]
                                    .forEach(function (event) {
                                        item.addEventListener(event, preventEvent, true);
                                    });
                            });
                        }
                    });
                }
            } else {
                LiveDevelopment._getInitialDocFromCurrent()
                    .done(function (doc) {
                        if (doc) {
                            previewDocumentPath = doc.file.fullPath;
                            previewFileFound = true;
                            loadContent();
                        } else {
                            $preview.find("iframe").attr("src", "");
                        
                            $message = $("<div class='alert-box'>")
                                .css({
                                    position: "relative",
                                    top: 100,
                                    width: 450,
                                    margin: "auto"
                                })
                                .html("Oops! I can't find an html file.")
                                .appendTo($preview);
                            
                        }
                    });
            }
        }
    }
     
    function currentDocumentChange() {
        if (_editor) {
            $(_editor).off("cursorActivity", indicateActiveMediaQuery);
            _editor = null;
        }
        
        // Remove any existing highlighting
        indicateActiveMediaQuery();
        
        var newDoc = DocumentManager.getCurrentDocument();
        if (newDoc && PathUtils.filenameExtension(newDoc.file.fullPath).search(/css/i) !== -1) {
            _editor = EditorManager.getCurrentFullEditor();
            $(_editor).on("cursorActivity", indicateActiveMediaQuery);
        }
        
        // Reload preview document, if changed
        LiveDevelopment._getInitialDocFromCurrent()
            .done(function (doc) {
                if (!doc || doc.file.fullPath !== previewDocumentPath) {
                    loadContent(true);
                }
            });
    }
   
    // Load our stylesheet
    ExtensionUtils.loadStyleSheet(module, "MediaQueryHelper.css");
    
    // Add menu command
    var ENABLE_MEDIA_QUERY_PREVIEW      = "Enable Media Query Utilities";
    var CMD_ENABLE_MEDIA_QUERY_PREVIEW  = "utils.enableMediaQueryUtils";

    function updateMenuItemCheckmark() {
        CommandManager.get(CMD_ENABLE_MEDIA_QUERY_PREVIEW).setChecked(enabled);
    }

    function toggleEnableMediaQueryUtils() {
        enabled = !enabled;
        if (enabled) {
            loadContent();
            $preview.show();
            $icon.addClass("active");
        } else {
            $preview.hide();
            $icon.removeClass("active");
        }
        EditorManager.resizeEditor();
        updateMenuItemCheckmark();
    }
    
    // Register command and add menu item
    CommandManager.register(ENABLE_MEDIA_QUERY_PREVIEW, CMD_ENABLE_MEDIA_QUERY_PREVIEW, toggleEnableMediaQueryUtils);
    var menu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
    menu.addMenuItem(CMD_ENABLE_MEDIA_QUERY_PREVIEW);
    updateMenuItemCheckmark();
    
    // Toolbar icon
    $icon = $("<a id='media-query-preview-icon' href='#'></a>")
        .click(toggleEnableMediaQueryUtils)
        .appendTo($("#main-toolbar .buttons"));
    
    // Status indicator
    $("#status-info").append($status);
    
    // Refresh preview content on startup, when a document is saved, and on project open
    AppInit.appReady(loadContent);
    $(DocumentManager).on("documentSaved", loadContent);
    $(ProjectManager).on("projectOpen", function () {
        previewFileFound = false;
        loadContent();
    });

    // Listen for document change to setup active media query tracking
    AppInit.appReady(currentDocumentChange);
    $(DocumentManager).on("currentDocumentChange", currentDocumentChange);
});
