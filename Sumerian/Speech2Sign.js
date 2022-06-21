'use strict';

// The sumerian object can be used to access Sumerian engine
// types.
//
/* global sumerian */

// Called when play mode starts.
//
function setup(args, ctx) {
  AWS.config.region = 'us-east-1';
  var aws = ctx.world.getSystem("AwsSystem");
  var credentials = aws.sdkConfig.credentials;
  AWS.config.credentials = credentials;

  var requestUrl = getSignedUrl('wss', '<IOT_ID>-ats.iot.us-east-1.amazonaws.com', '/mqtt', 'iotdevicegateway', 'us-east-1', credentials);

  var client = MQTTConnect(ctx, requestUrl); //connect with the credentials we got from above

  ctx.worldData.mqttClient = client;
}



// Called on every render frame, after setup(). When used in a
// ScriptAction, this function is called only while the state
// containing the action is active.
function update(args, ctx) {
  AWS.config.region = 'us-east-1';
  var aws = ctx.world.getSystem("AwsSystem");
  var credentials = aws.sdkConfig.credentials;
  AWS.config.credentials = credentials;
  var requestUrl = getSignedUrl('wss', '<IOT_ID>-ats.iot.us-east-1.amazonaws.com', '/mqtt', 'iotdevicegateway', 'us-east-1', credentials);

  client = ctx.worldData.mqttClient;

  client.onConnectionLost = function(responseObject) { //callback if our connection is lost
    if (cleanup) {
      return;
    }
    console.log("iot connection lost: " + responseObject.errorMessage);
    setTimeout(MQTTConnect(ctx, requestUrl), 1000);
  };

  client.onMessageArrived = function(message) { //callback everytime a message arrives on our subscribed topic
    ctx.worldData.newMessage = true;
    try {
      if (ctx.worldData.newMessage && message && message.destinationName && message.payloadString) {
        ctx.worldData.newMessage = false;
        var idx = 0;
        var interval = setInterval(function(){
          var orig_msg = JSON.parse(message.payloadString).message + ' ';
          var chars = orig_msg.toUpperCase().split('');
          console.log('Processing character "%s"', chars[idx]);
          if (chars[idx] == ' '){
            if (typeof ctx.worldData.entit !== 'undefined') ctx.worldData.entit.hide();
            ctx.worldData.entit = ctx.world.by.name("Beaker_Pose_space").first();
            ctx.worldData.entit.show();
          }
          else {
            if (typeof ctx.worldData.entit !== 'undefined') ctx.worldData.entit.hide();
			  if(isLetter(chars[idx])){
				  ctx.worldData.entit = ctx.world.by.name("Beaker_Pose_" + chars[idx]).first();
				  ctx.worldData.entit.show();
			  } 
          }
          idx++;
          if(idx === chars.length) {
            if (typeof ctx.worldData.entit !== 'undefined') ctx.worldData.entit.hide();
            clearInterval(interval);
          }
        }, 700);
      }
    } catch (e) {
        console.log("error! onMessageArrived " + e);
    }
  };
}

function getSignedUrl(protocol, host, uri, service, region, credentials) {
  var datetime = AWS.util.date.iso8601(new Date()).replace(/[:\-]|\.\d{3}/g, '');
  var date = datetime.substr(0, 8);

  var method = 'GET';
  var protocol = 'wss';
  var uri = '/mqtt';
  var service = 'iotdevicegateway';
  var algorithm = 'AWS4-HMAC-SHA256';

  var credentialScope = date + '/' + region + '/' + service + '/' + 'aws4_request';
  var canonicalQuerystring = 'X-Amz-Algorithm=' + algorithm;
  canonicalQuerystring += '&X-Amz-Credential=' + encodeURIComponent(credentials.accessKeyId + '/' + credentialScope);
  canonicalQuerystring += '&X-Amz-Date=' + datetime;
  canonicalQuerystring += '&X-Amz-SignedHeaders=host';

  var canonicalHeaders = 'host:' + host + '\n';
  var payloadHash = AWS.util.crypto.sha256('', 'hex')
  var canonicalRequest = method + '\n' + uri + '\n' + canonicalQuerystring + '\n' + canonicalHeaders + '\nhost\n' + payloadHash;

  var stringToSign = algorithm + '\n' + datetime + '\n' + credentialScope + '\n' + AWS.util.crypto.sha256(canonicalRequest, 'hex');
  var signingKey = getSignatureKey(credentials.secretAccessKey, date, region, service);
  var signature = AWS.util.crypto.hmac(signingKey, stringToSign, 'hex');


  canonicalQuerystring += '&X-Amz-Signature=' + signature;
  if (credentials.sessionToken) {
    canonicalQuerystring += '&X-Amz-Security-Token=' + encodeURIComponent(credentials.sessionToken);
  }

  var requestUrl = protocol + '://' + host + uri + '?' + canonicalQuerystring;
  return requestUrl;
};

function getSignatureKey(key, date, region, service) {
  var kDate = AWS.util.crypto.hmac('AWS4' + key, date, 'buffer');
  var kRegion = AWS.util.crypto.hmac(kDate, region, 'buffer');
  var kService = AWS.util.crypto.hmac(kRegion, service, 'buffer');
  var kCredentials = AWS.util.crypto.hmac(kService, 'aws4_request', 'buffer');
  return kCredentials;
};
  
function MQTTConnect(ctx, requestUrl) {
  var clientId = String(Math.random()).replace('.', '') + "test";
  var client = new Paho.MQTT.Client(requestUrl, clientId);
  var connectOptions = {
    onSuccess: function() {
      console.log('Connected to IoT!');
      client.subscribe('transcribedtext');
    },
    useSSL: true,
    timeout: 3,
    mqttVersion: 4,
    onFailure: function() {
      console.log(requestUrl)
      console.error('Failed to connect to IoT :');
      setTimeout(MQTTConnect(ctx, requestUrl), 1000);
    }
  };
  client.connect(connectOptions);
  return client;
}

function sleep(ms) {
  return new Promise(resolve => {setTimeout(() => {resolve(true);}, ms);});
}

function isLetter(str) {
  return str.length === 1 && str.match(/[a-z]/i);
}

// Defines script parameters.
//
var parameters = [];