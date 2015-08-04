# rus
rcode URL Shortener, a URL shortener web service written in node with a redis backend.
Written by Adam `sigkill` Richardson.
Dependant on Jade and redis node.js client libraries.
Runs out of the box with the default redis server configuration, hosting an HTTP server on port 32600 (run 'node main.js').
Look and feel can be customized via the favicon, stylesheet, and templates in ./static.
Core functionality resides in main.js.

As of 04/08/2015, a live demo is running at http://rcode.ca:32600.

Licensed under MIT Zero; see ./LICENSE.
