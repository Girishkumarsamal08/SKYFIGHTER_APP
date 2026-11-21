/**
 * ==============================================================================
 * SKYFIGHTER DRONE VISION — ESP32-CAM (AI-THINKER) STREAMING FIRMWARE
 * ==============================================================================
 * Hardware:
 *   - AI-Thinker ESP32-CAM Development Board with OV2640 2MP Camera Sensor
 *   - Dedicated 5V / 2A Power Source (5V BEC or USB FTDI programmer)
 *
 * HARDWARE ISOLATION MANDATE:
 *   - The ESP32-CAM operates COMPLETELY INDEPENDENTLY from the flight controller
 *     (ESP32-S3 running ESP-FC firmware).
 *   - DO NOT connect OV2640 or camera pins to the ESP32-S3 GPIO headers.
 *   - Video transmission is 100% wireless over 2.4 GHz Wi-Fi.
 *
 * Supported Endpoints:
 *   - GET /stream          : Low-latency MJPEG HTTP video stream
 *   - GET /status          : Camera status, Wi-Fi RSSI, and resolution (JSON)
 *   - GET /control?var=... : Dynamic control of resolution, quality, and flash LED
 *   - GET /capture         : Single snapshot JPEG frame
 *   - GET /                : Diagnostics HTML portal
 * ==============================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "Arduino.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ------------------------------------------------------------------------------
// 1. WI-FI CONFIGURATION
// ------------------------------------------------------------------------------
// Replace with your local Wi-Fi router or Ground Station Wi-Fi hotspot SSID/Password:
#ifndef WIFI_SSID
#define WIFI_SSID "SKYFIGHTER_GCS"
#endif

#ifndef WIFI_PASS
#define WIFI_PASS "DroneVision2026"
#endif

// Optional fallback to Access Point mode if station connection fails:
#define ENABLE_AP_FALLBACK true
#define AP_SSID            "ESP32-CAM-DRONE"
#define AP_PASS            "12345678"

// ------------------------------------------------------------------------------
// 2. AI-THINKER ESP32-CAM PIN DEFINITIONS
// ------------------------------------------------------------------------------
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Onboard Flash LED (High Power White LED)
#define FLASH_LED_PIN      4

// ------------------------------------------------------------------------------
// 3. STREAM PROTOCOL HEADERS
// ------------------------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
bool flash_led_state = false;
unsigned long last_wifi_check = 0;
unsigned long frame_count = 0;

// ------------------------------------------------------------------------------
// 4. HTTP REQUEST HANDLERS
// ------------------------------------------------------------------------------

/**
 * Live MJPEG Video Stream Handler (GET /stream)
 */
static esp_err_t stream_handler(httpd_req_t *req) {
    camera_fb_t * fb = NULL;
    esp_err_t res = ESP_OK;
    size_t _jpg_buf_len = 0;
    uint8_t * _jpg_buf = NULL;
    char * part_buf[64];

    res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
    if(res != ESP_OK){
        return res;
    }
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    while(true){
        fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("[ERROR] Camera capture failed");
            res = ESP_FAIL;
        } else {
            if(fb->format != PIXFORMAT_JPEG){
                bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
                esp_camera_fb_return(fb);
                fb = NULL;
                if(!jpeg_converted){
                    Serial.println("[ERROR] JPEG compression failed");
                    res = ESP_FAIL;
                }
            } else {
                _jpg_buf_len = fb->len;
                _jpg_buf = fb->buf;
            }
        }
        if(res == ESP_OK){
            size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
            res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
        }
        if(res == ESP_OK){
            res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
        }
        if(res == ESP_OK){
            res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
        }
        if(fb){
            esp_camera_fb_return(fb);
            fb = NULL;
            _jpg_buf = NULL;
        } else if(_jpg_buf){
            free(_jpg_buf);
            _jpg_buf = NULL;
        }
        if(res != ESP_OK){
            break;
        }
        frame_count++;
    }
    return res;
}

/**
 * Camera Status Endpoint (GET /status)
 */
static esp_err_t status_handler(httpd_req_t *req) {
    sensor_t * s = esp_camera_sensor_get();
    if (!s) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    char json_response[256];
    snprintf(json_response, sizeof(json_response),
        "{\"status\":\"online\",\"framesize\":%d,\"quality\":%d,\"flash\":%d,"
        "\"wifi_rssi\":%d,\"free_heap\":%u,\"uptime_ms\":%lu,\"frames\":%lu}",
        s->status.framesize, s->status.quality, flash_led_state ? 1 : 0,
        WiFi.RSSI(), ESP.getFreeHeap(), millis(), frame_count
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, json_response, strlen(json_response));
}

/**
 * Single Snapshot Capture (GET /capture)
 */
static esp_err_t capture_handler(httpd_req_t *req) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("[ERROR] Frame buffer capture failed");
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    
    esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return res;
}

/**
 * Dynamic Camera Control Endpoint (GET /control?var=...&val=...)
 */
static esp_err_t control_handler(httpd_req_t *req) {
    char*  buf;
    size_t buf_len;
    char variable[32] = {0,};
    char value[32] = {0,};

    buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1) {
        buf = (char*)malloc(buf_len);
        if(!buf){
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }
        if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK) {
            if (httpd_query_key_value(buf, "var", variable, sizeof(variable)) == ESP_OK &&
                httpd_query_key_value(buf, "val", value, sizeof(value)) == ESP_OK) {
            } else {
                free(buf);
                httpd_resp_send_404(req);
                return ESP_FAIL;
            }
        } else {
            free(buf);
            httpd_resp_send_404(req);
            return ESP_FAIL;
        }
        free(buf);
    } else {
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    int val = atoi(value);
    sensor_t * s = esp_camera_sensor_get();
    int res = 0;

    if(!strcmp(variable, "framesize")) {
        if(s->pixformat == PIXFORMAT_JPEG) {
            res = s->set_framesize(s, (framesize_t)val);
        }
    }
    else if(!strcmp(variable, "quality")) res = s->set_quality(s, val);
    else if(!strcmp(variable, "flash")) {
        flash_led_state = (val > 0);
        digitalWrite(FLASH_LED_PIN, flash_led_state ? HIGH : LOW);
    }
    else {
        res = -1;
    }

    if(res){
        return httpd_resp_send_500(req);
    }

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, "OK", 2);
}

/**
 * Root Landing Page (GET /)
 */
static esp_err_t index_handler(httpd_req_t *req) {
    const char* html = 
        "<!DOCTYPE html><html><head><title>ESP32-CAM Drone Vision</title>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<style>body{background:#0b0f19;color:#e2e8f0;font-family:sans-serif;padding:24px;text-align:center;}"
        "h1{color:#00d4ff;}a{color:#38bdf8;text-decoration:none;font-weight:bold;}"
        ".box{background:#161f30;border:1px solid #273549;border-radius:12px;padding:20px;max-width:520px;margin:20px auto;text-align:left;}"
        "code{background:#000;color:#22c55e;padding:3px 6px;border-radius:4px;}"
        "</style></head><body>"
        "<h1>SKYFIGHTER DRONE VISION</h1>"
        "<p>AI-Thinker ESP32-CAM (OV2640) Online</p>"
        "<div class='box'>"
        "<h3>Active Endpoints:</h3>"
        "<ul>"
        "<li><b>Stream:</b> <a href='/stream'>/stream</a> (MJPEG)</li>"
        "<li><b>Status:</b> <a href='/status'>/status</a> (JSON)</li>"
        "<li><b>Capture:</b> <a href='/capture'>/capture</a> (JPEG)</li>"
        "<li><b>Control:</b> <code>/control?var=framesize&val=7</code> (VGA)</li>"
        "</ul>"
        "<p>Configure in Python GCS: <code>http://[THIS_IP]/stream</code></p>"
        "</div></body></html>";

    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, html, strlen(html));
}

// ------------------------------------------------------------------------------
// 5. SERVER INITIALIZATION
// ------------------------------------------------------------------------------
void startCameraServer(){
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.ctrl_port = 32768;

    httpd_uri_t stream_uri = {
        .uri       = "/stream",
        .method    = HTTP_GET,
        .handler   = stream_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t status_uri = {
        .uri       = "/status",
        .method    = HTTP_GET,
        .handler   = status_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t capture_uri = {
        .uri       = "/capture",
        .method    = HTTP_GET,
        .handler   = capture_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t control_uri = {
        .uri       = "/control",
        .method    = HTTP_GET,
        .handler   = control_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t index_uri = {
        .uri       = "/",
        .method    = HTTP_GET,
        .handler   = index_handler,
        .user_ctx  = NULL
    };

    if (httpd_start(&stream_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(stream_httpd, &stream_uri);
        httpd_register_uri_handler(stream_httpd, &status_uri);
        httpd_register_uri_handler(stream_httpd, &capture_uri);
        httpd_register_uri_handler(stream_httpd, &control_uri);
        httpd_register_uri_handler(stream_httpd, &index_uri);
        Serial.printf("[INFO] HTTP MJPEG Camera server started on port %d\n", config.server_port);
    }
}

// ------------------------------------------------------------------------------
// 6. SETUP & MAIN LOOP
// ------------------------------------------------------------------------------
void setup() {
    // Disable brownout detector for camera current spikes during Wi-Fi transmission
    WRITE_PERI_REG(RTC_CNTL_BROWNOUT_REG, 0);

    Serial.begin(115200);
    Serial.setDebugOutput(false);
    Serial.println("\n\n========================================");
    Serial.println("  SKYFIGHTER ESP32-CAM (AI-THINKER)");
    Serial.println("========================================");

    pinMode(FLASH_LED_PIN, OUTPUT);
    digitalWrite(FLASH_LED_PIN, LOW);

    // Camera Configuration
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = Y2_GPIO_NUM;
    config.pin_d1       = Y3_GPIO_NUM;
    config.pin_d2       = Y4_GPIO_NUM;
    config.pin_d3       = Y5_GPIO_NUM;
    config.pin_d4       = Y6_GPIO_NUM;
    config.pin_d5       = Y7_GPIO_NUM;
    config.pin_d6       = Y8_GPIO_NUM;
    config.pin_d7       = Y9_GPIO_NUM;
    config.pin_xclk     = XCLK_GPIO_NUM;
    config.pin_pclk     = PCLK_GPIO_NUM;
    config.pin_vsync    = VSYNC_GPIO_NUM;
    config.pin_href     = HREF_GPIO_NUM;
    config.pin_sscb_sda = SIOD_GPIO_NUM;
    config.pin_sscb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn     = PWDN_GPIO_NUM;
    config.pin_reset    = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;

    // Check PSRAM availability
    if(psramFound()){
        Serial.println("[INFO] PSRAM found! Initializing dual frame buffers.");
        // Start with VGA (640x480) for rock-solid low-latency streaming
        config.frame_size = FRAMESIZE_VGA;
        config.jpeg_quality = 12; // 10-63 (lower = higher quality)
        config.fb_count = 2;
        config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
        Serial.println("[WARN] No PSRAM detected. Setting conservative frame size.");
        config.frame_size = FRAMESIZE_QVGA; // 320x240
        config.jpeg_quality = 16;
        config.fb_count = 1;
    }

    // Initialize Camera Sensor
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("[FATAL] Camera init failed with error 0x%x\n", err);
        return;
    }

    sensor_t * s = esp_camera_sensor_get();
    if (s != NULL) {
        s->set_vflip(s, 1);    // Vertical flip if mounted inverted on drone frame
        s->set_hmirror(s, 0);  // Horizontal mirror
    }
    Serial.println("[INFO] OV2640 camera hardware initialized successfully.");

    // Connect to Wi-Fi
    Serial.printf("[INFO] Connecting to Wi-Fi SSID: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 25) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[INFO] Wi-Fi connected successfully!");
        Serial.print("[INFO] Camera Stream URL: http://");
        Serial.print(WiFi.localIP());
        Serial.println("/stream");
    } else {
        Serial.println("\n[WARN] Failed to connect to configured station network.");
        if (ENABLE_AP_FALLBACK) {
            Serial.printf("[INFO] Starting Access Point: %s\n", AP_SSID);
            WiFi.mode(WIFI_AP);
            WiFi.softAP(AP_SSID, AP_PASS);
            Serial.print("[INFO] AP Camera Stream URL: http://");
            Serial.print(WiFi.softAPIP());
            Serial.println("/stream");
        }
    }

    // Start HTTP Streaming Server
    startCameraServer();
}

void loop() {
    // Non-blocking Wi-Fi auto-reconnection monitor
    if (WiFi.getMode() == WIFI_STA && millis() - last_wifi_check > 5000) {
        last_wifi_check = millis();
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("[WARN] Wi-Fi lost! Attempting auto-reconnect...");
            WiFi.reconnect();
        }
    }
    delay(10);
}
