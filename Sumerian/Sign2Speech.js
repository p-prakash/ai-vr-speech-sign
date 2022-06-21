'use strict';

function setup(args, ctx) {
  AWS.config.region = 'us-east-1';
  var aws = ctx.world.getSystem("AwsSystem");
  var credentials = aws.sdkConfig.credentials;
  AWS.config.credentials = credentials;

  var requestUrl = getSignedUrl('wss', '<IOT_ID>-ats.iot.us-east-1.amazonaws.com', '/mqtt', 'iotdevicegateway', 'us-east-1', credentials);

  var client = MQTTConnect(ctx, requestUrl); //connect with the credentials we got from above

  ctx.worldData.mqttClient = client;
  ctx.entityData.Speech = new SpeechController("aslHostSpeech", args.host, "Amy");
};

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
    try {
      if (message && message.destinationName && message.payloadString) {
        orig_msg = JSON.parse(message.payloadString).text;
        var URL = 'https://<APIGW_ID>.execute-api.us-east-1.amazonaws.com/prod/latest';
        var msgURL = 'https://<APIGW_ID.execute-api.us-east-1.amazonaws.com/prod/message?text=' + orig_msg;
        console.log(msgURL);
        $.get(URL, function(latest, status){
          $.get(msgURL, function(msg, status){
            console.log('Message:', msg.message);
            console.log('Voice:', latest.voice);
            ctx.entityData.Speech.playSpeech(msg.message, latest.voice);
          });
        });
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
      client.subscribe('$aws/things/deeplens_1aqBTzF_QT2tn4mEedh9MQ/infer');
      console.log('Connected to IoT!');
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

/**
  * SpeechController is a wrapper around the Sumerian Speech component.
  * @param {Entity} host The entity that uses the Speech component
  * @param {String} voice The Amazon Polly voice ID used for the speech.
  *
  */
 class SpeechController {
  constructor(speechCaptionId, host, voice) {
      if (!host.getComponent("SpeechComponent")) {
              sumerian.SystemBus.emit("sumerian.warning", { title: "Speech Component missing on the Host", message: `Please add the Speech Component on the ${host.name} entity.`});
      }

      this._speech = new sumerian.Speech();
      this._speechCaption = document.getElementById(speechCaptionId);
      this._host = host;
      this._hostSpeechComponent = host.getComponent("SpeechComponent");
      this._voice = voice;
      this._isSpeaking = false;
  }

  get isSpeaking() {
      return this._isSpeaking;
  }

  /**
   * Dynamically creates and plays a string of text
   * @param {String} [body], body of text
   * @param {String} [voice], voice to be spoken
   */
  playSpeech(body, voice) {
      this._isSpeaking = true;

      this._hostSpeechComponent.addSpeech(this._speech);

      this._speech.updateConfig({
          entity: this._host,
          body: '<speak>' + body + '</speak>',
          type: 'ssml',
          voice: voice
      });

      this._speech.play().then(() => {
          this._isSpeaking = false;
      });
  };

  /**
   * Calls Speech.stop() to stop all speeches
   */
  stopSpeech() {
      this._speech.stop();
  }
}

// Defines script parameters.
//
var parameters = [
  {
      name: 'Host',
      key: 'host',
      type: 'entity',
      description: "Drop the Host entity that's used for the screen setup here. This entity is named 'Host' in this asset pack."
  },
];