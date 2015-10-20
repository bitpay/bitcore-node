# Web Service
The web service creates an express app which can be used by services for setting up web routes for API's, static content, web applications, etc. This allows users to interact with various bitcore node services over one http or https port.

In order for your service to add routes, it must implement the `setupRoutes()` and `getRoutePrefix()` methods.

## Example

```js
MyService.prototype.setupRoutes = function(app, express) {
  // Set up routes
  app.get('/hello', function(req, res) {
    res.send('world');
  });

  // Serve static content
  app.use('/static', express.static(__dirname + '/static'));
};

MyService.prototype.getRoutePrefix = function() {
  return 'my-service'
};
```

## Configuring Web Service for HTTPS
You can run the web service over https by editing your bitcore node config, setting https to true and adding httpsOptions:

```json
{
  "port": 3001,
  "https": true,
  "httpsOptions": {
    "key": "path-to-private-key",
    "cert": "path-to-certificate"
  },
  "services": [
    "web"
  ]
}
```
