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
//  initial preview file
//  make sure extra work is only done when extension is active
//  unit tests
//  disable iframe clicks/focus
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
        Inspector           = brackets.getModule("LiveDevelopment/Inspector/Inspector"),
        Menus               = brackets.getModule("command/Menus"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        RemoteAgent         = brackets.getModule("LiveDevelopment/Agents/RemoteAgent");
    
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
            .append($("<a class='size-link' href='#'>" + size + "px</a>"));
        
        $preview.append($thumbnail);
        
        xPos += (scaledWidth + PADDING);
    });
    
    // Add label click handlers to find and open the nearest match
    $preview.find("a").click(function (e) {
        var width = /[0-9]*/.exec(e.target.innerText)[0];
        
        var query = MediaQueryModel.findClosestMatch(width);
        
        if (query) {
            CommandManager.execute(Commands.FILE_OPEN, {fullPath: query.textRange.document.file.fullPath})
                .done(function (doc) {
                    // Opened document is now the current main editor
                    EditorManager.getCurrentFullEditor().setSelection(
                        {line: query.textRange.startLine, ch: 0},
                        {line: query.textRange.endLine + 1, ch: 0}
                    );
                    
                    // Highlight the doc in the project tree
                    CommandManager.execute(Commands.NAVIGATE_SHOW_IN_FILE_TREE);
                });
        }
    });
    
    // Add preview to the main toolbar
    $preview.hide().appendTo("#main-toolbar");

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
    }
    
    // State properties
    var enabled = false;
    
    // Load the preview document into the iframes. For now we look for "index.html"
    // in the root of the project directory. We will need to do something smarter
    // than this...
    function loadContent() {
        if (enabled) {
            var previewDocumentPath = ProjectManager.getProjectRoot().fullPath + previewFile;
            
            $preview.find(".no-preview-file").remove();
            
            if (previewFileFound) {
                var $iframes = $preview.find("iframe");
                
                // Can't just compare src with previewDocumentPath since src may have "file://localhost" prepended
                if ($iframes[0].src.indexOf(previewDocumentPath) !== -1) {
                    $iframes.each(function (index, frame) {
                        frame.contentWindow.location.reload(true);
                    });
                } else {
                    $iframes.attr("src", previewDocumentPath);
                }
            } else {
                brackets.fs.stat(previewDocumentPath, function (err) {
                    if (!err) {
                        previewFileFound = true;
                        loadContent();
                    } else {
                        $preview.find("iframe").attr("src", "");
                        
                        /*
                        var $fileSelector = $("<div class='no-preview-file'></div>")
                            .append($("<div class='alert-message'>Enter a file to preview</div>"))
                            .append($("<div><input prompt='index.html'></input></div>"))
                            .appendTo($preview);
                        */
                        
                        
                        var $message = $("<div class='no-preview-file alert-message'>")
                            .css({
                                top: 100,
                                width: 450,
                                margin: "auto"
                            })
                            .html("Oops! I can't find an <span class='dialog-filename'>index.html</span> file at the root of your project.")
                            .appendTo($preview);
                        
                    }
                });
            }
        }
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
        } else {
            $preview.hide();
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
    var $icon = $("<a id='media-query-preview-icon' href='#'></a>")
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
