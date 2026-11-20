# Conversation add menu

English | [中文](README.zh.md)

Adds a monochrome menu to the existing conversation plus button. Files use the native attachment picker; project selection opens a new conversation with the current draft; GitHub links, Skills, design guidelines, and a web research requirement are inserted into the draft. Connector and plugin menus show the installed inventory and open its configuration pages. Nothing is submitted automatically. Existing keyboard command and slash menus remain available.

The menu is scoped to each mounted composer and supports keyboard navigation and outside dismissal. The plus button reports whether the menu is expanded, and loading feedback appears in the submenu that requested data. Unloading restores the original button attributes and removes the menu's event handlers. Draft insertions reject stale editor selections.
