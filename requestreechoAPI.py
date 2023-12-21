import requests
import base64

API_ENDPOINT = "https://api.reecho.ai/v1/SYNTHESIZE/sync" 

headers = {
  "Authorization": "Bearer <your_api_key>"
}

data = {
  "text": "Hello World",
  "speaker_id": "1234567",
  "emotion": "neutral"
}

response = requests.post(API_ENDPOINT, headers=headers, json=data)

if response.status_code == 200:
  audio_content = base64.b64decode(response.json()['audio_base64']) 
  with open('output.wav', 'wb') as f:
    f.write(audio_content)
  print("Audio content written to output.wav")
else:
  print("Request failed with status code:", response.status_code)
