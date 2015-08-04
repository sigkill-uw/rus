/* HTTP server, query parser, Jade renderer, filesystem acces, redis client */
var http = require("http");
var qs = require('querystring');
var jade = require("jade");
var fs = require("fs");
var redis = require("redis");

/* Requests to be served directly from the filesystem (w/ corresponding MIME type) */
var filesystem_whitelist = {"/style.css": "text/css", "/favicon.ico": "image/x-icon"};

/* Jade renderers for the UI */
var interface_renderer = jade.compileFile("static/interface.jade");
var not_found_renderer = jade.compileFile("static/404.jade");

/* Instantiate HTTP server*/
var http_server = http.createServer(function(request, response) {
	console.log(getTimeStamp(), request.method, "request received to URL", request.url, "from IP", request.connection.remoteAddress);

	/* Serve appropriate files directly from the filesystem */
	if(filesystem_whitelist[request.url])
	{
		/* Serve the file if we can read it, otherwise serve an internal server error */
		fs.readFile("static/" + request.url, function(err, data) {
			if(err)
			{
				var text = "Something went wrong. Please try again later.";

				response.writeHead(500, {"Content-Length": text.length, "Content-Type": "text/plain"});
				response.end(text);
			}
			else
			{
				/* Use appropriate MIME type */
				response.writeHead(200, {"Content-Length": data.length, "Content-Type": filesystem_whitelist[request.url]});
				response.end(data);
			}
		});
	}
	else if(request.url == "/") /* Requests to the root mean interaction with the UI */
	{
		/* A POST request should mean a successfully submitted form */
		if(request.method == "POST")
		{
			/* Buffer POST data */
			var raw = "";
			request.on("data", function(chunk){ raw += chunk.toString(); })

			/* Parse and process data when we're done receiving */
			request.on("end", function() {
				/* Parse */
				var post_data = qs.parse(raw);

				/* If we have a non-empty url... */
				if(post_data.url)
				{
					/* Make sure it actually has a protocol. It might be mangled but whatever */
					var original_url = (post_data.url.indexOf(":") == -1) ? "http://" + post_data.url : post_data.url;

					/* Insert the URL into the DB and construct the shortened URL */
					insertURL(original_url, function(err, identifier) {
						if(err) /* Failure */
						{
							var response_text = interface_renderer({shortened: false, failure: true});
							response.writeHead(200, {"Content-Length": response_text.length, "Content-Type": "text/html"});
							response.end(response_text);
						}
						else
						{
							var shortened_url = "http://" + request.headers.host + "/" + identifier;

							var response_text = interface_renderer(
								{shortened: true, "original_url": original_url, "shortened_url": shortened_url});
							response.writeHead(200, {"Content-Length": response_text.length, "Content-Type": "text/html"});
							response.end(response_text);

							console.log(getTimeStamp(), "Map created from", original_url, "to", "/" + identifier);
						}
					});
				}
				else /* Failure */
				{
					var response_text = interface_renderer({shortened: false, failure: true});
					response.writeHead(200, {"Content-Length": response_text.length, "Content-Type": "text/html"});
					response.end(response_text);
				}
			});
		}
		else /* If it's not POST, just serve the static interface */
		{
			var response_text = interface_renderer({shortened: false});

			response.writeHead(200, {"Content-Length": response_text.length, "Content-Type": "text/html"});
			response.end(response_text);
		}
	}
	else /* Any other request is an attempt to access a shortened URL */
	{
		/* Trim leading '/' */
		var identifier = request.url.substring(1);

		/* Fetch the associated URL for the identifier */
		fetchURL(identifier, function(err, url) {
			if(err)
			{
				/* Assume errors are 404 */
				var response_text = not_found_renderer({});
				response.writeHead(404, {"Content-Length": response_text.length, "Content-Type": "text/html"});
				response.end(response_text);

				console.log(getTimeStamp(), "Unsuccessful request to redirect", request.url);
			}
			else
			{
				/* Redirect to the appropriate location */
				response.writeHead(301, {"Location": url});
				response.end();

				console.log(getTimeStamp(), "Successful request to redirect", request.url);
			}
		});
	}
});

/* Prefix for redis URL keys */
var url_key_prefix = "URL_KEY_";

/* Returns a timestamp string [dd/mm/yyyy hh:mm:ss] for a given date */
function getTimeStamp(date)
{
	date = date || new Date();

	var day = date.getDate().toString();
	if(day.length < 2) day = "0" + day;

	var month = date.getMonth().toString();
	if(month.length < 2) month = "0" + month;

	var year = date.getFullYear().toString();

	var hour = date.getHours().toString();
	if(hour.length < 2) hour = "0" + hour;

	var minute = date.getMinutes().toString();
	if(minute.length < 2) minute = "0" + minute;

	var second = date.getSeconds().toString();
	if(second.length < 2) second = "0" + second;

	return "[" + day + "/" + month + "/" + year + " " + hour + ":" + minute + ":" + second + "]";
}

/* Returns a random string of URL-safe characters of a given length */
function getRandomIdentifier(length)
{
	/* Extra character on the end because of paranoia over rounding */
	/* Also not using the full alphabet before of paranoia over slurs */
	var legal_characters = "abcdefgxyzABCDEFGXYZ0123456789_ ";

	/* Build this string */
	var string = "";
	for(var i = 0; i < length; i ++)
		string += legal_characters[Math.floor(Math.random() * (legal_characters.length - 1))]; /* -1 for paranoia */

	return string;
}

/* Inserts a given URL into the redis URL DB and calls the callback with params (err, identifier) */
function insertURL(url, callback)
{
	/* Connect to redis server */
	var client = redis.createClient();

	var insertURLInternal = function(url, callback) {
		/* Generate random identifier */
		var identifier = getRandomIdentifier(8);

		/* Check if the key already exists */
		client.exists(url_key_prefix + identifier, function(err, reply) {
			if(err) callback(err, null); /* Propagate error */
			else if(reply == 1) insertURLInternal(url, callback); /* Retry if key exists */
			else /* Otherwise, insert */
			{
				client.set([url_key_prefix + identifier, url], function(err, reply) {
					client.quit();

					if(err) callback(err, null); /* Propagate error */
					else callback(null, identifier); /* Successful insertion! */
				});
			}
		});
	};

	insertURLInternal(url, callback);
}

/* Fetches a given URL based on identifier and calls the callback with params (err, url) */
function fetchURL(id, callback)
{
	/* Connect to redis server */
	var client = redis.createClient();

	/* Query the DB */
	client.get(url_key_prefix + id, function(err, reply) {
		/* Quit */
		client.quit();

		if(err || !reply) callback(err || true, null); /* Propagate error */
		else callback(null, reply); /* Succesful retrieval */
	});
}

/* Listen for HTTP requests */
http_server.listen(32600);
