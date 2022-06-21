""" Lambda function to detect ASL """
from threading import Thread, Event
import os
import boto3
import json
import numpy as np
import awscam
import cv2
import mo
import greengrasssdk
import logging

jpeg = None

class LocalDisplay(Thread):
    """ Class for facilitating the local display of inference results
        (as images). The class is designed to run on its own thread. In
        particular the class dumps the inference results into a FIFO
        located in the tmp directory (which lambda has access to). The
        results can be rendered using mplayer by typing:
        mplayer -demuxer lavf -lavfdopts format=mjpeg:probesize=32 /tmp/results.mjpeg
    """
    def __init__(self, resolution):
        """ resolution - Desired resolution of the project stream """
        # Initialize the base class, so that the object can run on its own thread.
        super(LocalDisplay, self).__init__()
        # List of valid resolutions
        RESOLUTION = {'1080p' : (1920, 1080), '720p' : (1280, 720), '480p' : (858, 480)}
        if resolution not in RESOLUTION:
            raise Exception("Invalid resolution")
        self.resolution = RESOLUTION[resolution]
        # Initialize the default image to be a white canvas. Clients will update the image when ready.
        self.frame = cv2.imencode('.jpg', 255*np.ones([640, 480, 3]))[1]
        self.stop_request = Event()

    def run(self):
        """ Overridden method that continually dumps images to the desired FIFO file. """
        # Path to the FIFO file. The lambda only has permissions to the tmp directory.
        # Pointing to a FIFO file in another directory will cause the lambda to crash.
        result_path = '/tmp/results.mjpeg'
        # Create the FIFO file if it doesn't exist.
        if not os.path.exists(result_path):
            os.mkfifo(result_path)
        # This call will block until a consumer is available
        with open(result_path, 'w') as fifo_file:
            while not self.stop_request.isSet():
                try:
                    # Write the data to the FIFO file. This call will block meaning the code will come to a 
                    # halt here until a consumer is available.
                    fifo_file.write(self.frame.tobytes())
                except IOError:
                    continue

    def set_frame_data(self, frame):
        """ Method updates the image data. This currently encodes the numpy array to jpg but can be modified
            to support other encodings.
            frame - Numpy array containing the image data of the next frame in the project stream.
        """
        ret, jpeg = cv2.imencode('.jpg', cv2.resize(frame, self.resolution))
        if not ret:
            raise Exception('Failed to set frame data')
        self.frame = jpeg

    def join(self):
        self.stop_request.set()

def detect_asl():
    """ Entry point of the lambda function"""
    logging.basicConfig(level=logging.DEBUG)
    # Creating a client to send messages via IoT MQTT to the cloud
    client = greengrasssdk.client('iot-data')
    # This is the topic where we will publish our messages too
    iot_topic = '$aws/things/{}/infer'.format(os.environ['AWS_IOT_THING_NAME'])
    try:
        # define model prefix and the amount to down sample the image by.
        input_height = 200
        input_width = 200
        model_name="image-classification"
        # Send message to IoT via MQTT
        client.publish(topic=iot_topic, payload="Optimizing model")
        ret, model_path = mo.optimize(model_name, input_width, input_height, platform='mx')
        # Send message to IoT via MQTT
        client.publish(topic=iot_topic, payload="Model optimization complete")
        if ret is not 0:
            raise Exception("Model optimization failed, error code: {}".format(ret))
        # Send message to IoT via MQTT
        client.publish(topic=iot_topic, payload="Loading model")
        # Load the model into cl-dnn
        model = awscam.Model(model_path, {"GPU": 1})
        # Send message to IoT via MQTT
        client.publish(topic=iot_topic, payload="Model loaded")

        # This model is a ResNet classifier, so our output will be classification.
        model_type = 'classification'
        # Dictionary that will allow us to convert the inference labels into a human a readable format.
        output_map = {0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G',
                      7: 'H', 8: 'I', 9: 'J', 10: 'K', 11: 'L', 12: 'M',
                      13: 'N', 14: 'O', 15: 'P', 16: 'Q', 17: 'R', 18: 'S',
                      19: 'T', 20: 'U', 21: 'V', 22: 'W', 23: 'X', 24: 'Y',
                      25: 'Z', 26: 'Delete', 27: 'Space', 28: 'Nothing'}

        # Create a local display instance that will dump the image bytes to a FIFO
        # file that the image can be rendered locally.
        local_display = LocalDisplay('480p')
        local_display.start()
        
        # Form sentence
        detected_char = ''
        current_char = ''
        sentence = ''
        frame_counter = 0
        min_count = 6 # Video streams at 3.5 frames/sec hence ~1.5 seconds
        end_count = 18 # If there are no content detected in ~5 seconds end the sentence
        
        # Do inference until the lambda is killed.
        while True:
            # Get a frame from the video stream
            ret, frame = awscam.getLastFrame()
            if not ret:
                raise Exception('Failed to get frame from the stream')
            
            # Default resolution of Deeplens frame is 1520x2688
            height, width, channels = frame.shape
            height_margin = int(height / 7)
            width_margin = int(width / 4)
            cropped_frame = frame[height_margin:-height_margin, width_margin:-width_margin]
            # Resize frame to the same size as the training set.
            frame_resize = cv2.resize(cropped_frame, (input_height, input_width))

            parsed_inference_results = model.parseResult(model_type,
                                                         model.doInference(frame_resize))
            print(parsed_inference_results)
            # Get result with highest probability if it's greater than 50% else return nothing
            curr_max = 0.5
            pred = 28
            for lbl in parsed_inference_results[model_type]:
                if lbl['prob'] > curr_max:
                    curr_max = lbl['prob']
                    pred = lbl['label']
            # pred = np.argmax(parsed_inference_results[model_type])
            print('Predicted value is %s' % output_map[pred])
            current_char = output_map[pred]
            frame_counter += 1
            if pred < 26 and current_char != detected_char:
                frame_counter = 0
                detected_char = current_char
            elif pred != 28 and frame_counter > min_count:
                if pred == 26:
                    sentence = sentence[:-1]
                if pred == 27:
                    sentence += ' '
                else:
                    sentence += detected_char
                frame_counter = 0
                detected_char = ''
            elif pred == 28 and frame_counter > end_count and sentence != '':
                print('Time to make action.')
                # Send the result to the IoT console via MQTT
                cloud_output = {'text': sentence}
                client.publish(topic=iot_topic, payload=json.dumps(cloud_output))
                frame_counter = 0
                sentence = ''
                detected_char = ''
            
            # Set the next frame in the local display stream.
            cv2.putText(cropped_frame, 'Character : ' + detected_char, (10, 70),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255),
                            3)
            cv2.putText(cropped_frame, 'Sentence : ' + sentence, (10, 1016),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 3)
            local_display.set_frame_data(cropped_frame)
            
    except Exception as ex:
        client.publish(topic=iot_topic, payload='Error in detect_asl lambda: {}'.format(ex))

detect_asl()

# This is a dummy handler and will not be invoked.
# Instead, the code is executed in an infinite loop.
def function_handler(event, context):
    return