#include <ESP_I2S.h>

I2SClass I2S;

#define MIC_BCLK 4
#define MIC_WS   5
#define MIC_SD   6

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\nMITO - Microphone Diagnostic");

  I2S.setPins(MIC_BCLK, MIC_WS, -1, MIC_SD, -1);

  if (!I2S.begin(
        I2S_MODE_STD,
        16000,
        I2S_DATA_BIT_WIDTH_32BIT,
        I2S_SLOT_MODE_MONO)) {
    Serial.println("ERROR: I2S initialization failed!");
    while (true) {
      delay(1000);
    }
  }

  Serial.println("I2S initialized.");
  Serial.println("Speak or clap near the microphone.");
}

void loop() {
  int32_t samples[128];

  size_t bytesRead = I2S.readBytes(
    (char *)samples,
    sizeof(samples)
  );

  if (bytesRead == 0) {
    Serial.println("ERROR: No audio data received!");
    delay(500);
    return;
  }

  int32_t minValue = INT32_MAX;
  int32_t maxValue = INT32_MIN;

  size_t count = bytesRead / sizeof(int32_t);

  for (size_t i = 0; i < count; i++) {
    if (samples[i] < minValue) minValue = samples[i];
    if (samples[i] > maxValue) maxValue = samples[i];
  }

  Serial.print("Bytes: ");
  Serial.print(bytesRead);
  Serial.print(" | Min: ");
  Serial.print(minValue);
  Serial.print(" | Max: ");
  Serial.println(maxValue);

  delay(100);
}