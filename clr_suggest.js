const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const convert = require('color-convert');
const getColors = require('get-image-colors');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const Jimp = require('jimp');
const EventEmitter = require('events');
const emitter = new EventEmitter();
const axios = require('axios');
const path = require('path');
const { exit } = require('process');
const { setMaxIdleHTTPParsers } = require('http');
emitter.setMaxListeners(20);

async function downloadImageFromS3(s3Url) {
    try {
      const response = await axios.get(s3Url, { responseType: 'stream' });
  
      const fileExtension = path.extname(s3Url);
  
      const filename = `${Date.now()}${fileExtension}`;
  
      const writeStream = fs.createWriteStream(filename);
  
      response.data.pipe(writeStream);
  
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
  
      console.log(`Image downloaded and saved as ${filename}`);
      return filename
    } catch (error) {
      console.error('Error downloading image:', error.message);
    }
}
  
async function colorDiff(color1, color2){
    // Convert colors to LAB format
    const labColor1 = colorDifference.hex2lab(color1);
    const labColor2 = colorDifference.hex2lab(color2);

    const deltaE = colorDifference.compare(labColor1, labColor2);

    const similarityThreshold = 10;

    const areColorsSimilar = deltaE <= similarityThreshold;

    console.log(`Color difference (Delta E): ${deltaE}`);
    console.log(`Are the colors similar? ${areColorsSimilar}`);
}

async function downloadImage(url) {
    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return buffer;
    } catch (error) {
        console.error('Error downloading image:', error);
        throw error;
    }
}

async function analyzeTextBackgroundColor(colors, text) {
    let textColor = null;
    let backgroundColor = null;
    if (colors.length >= 2) {
        textColor = colors[1].hex();
        backgroundColor = colors[0].hex();
    }
    return { textColor, backgroundColor };
}

async function analyzeImage(img_name) {
    try {
        const imageBuffer = fs.readFileSync(img_name);
        const { data: { text } } = await Tesseract.recognize(imageBuffer);
        const colors = await getColors(img_name, {
            count: 2,
        });
        // return colors.map(color => color.hex());
        const textInfo = await analyzeTextBackgroundColor(colors, text);
        return {
            text,
            textInfo,
            dominantColors: colors.map(color => color.hex()),
        };
    } catch (error) {
        console.error('Error analyzing image:', error);
        throw error;
    }
}

async function lightenColor(color, step) {
    const hex = color.substring(1);
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
  
    r = Math.min(255, r + step * 255);
    g = Math.min(255, g + step * 255);
    b = Math.min(255, b + step * 255);
  
    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);
  
    return `#${(r < 16 ? '0' : '') + r.toString(16)}${(g < 16 ? '0' : '') + g.toString(16)}${(b < 16 ? '0' : '') + b.toString(16)}`;
}

async function brightenColor(color, step) {
    const hex = color.substring(1);
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    r = Math.max(0, r - step * 255);
    g = Math.max(0, g - step * 255);
    b = Math.max(0, b - step * 255);

    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);

    return `#${(r < 16 ? '0' : '') + r.toString(16)}${(g < 16 ? '0' : '') + g.toString(16)}${(b < 16 ? '0' : '') + b.toString(16)}`;
}

async function calculateContrastRatio(color1, color2) {
    const calculateRelativeLuminance = (color) => {
      const normalize = (value) => {
        value /= 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
  
      const r = normalize(parseInt(color.slice(1, 3), 16));
      const g = normalize(parseInt(color.slice(3, 5), 16));
      const b = normalize(parseInt(color.slice(5, 7), 16));
  
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const luminance1 = calculateRelativeLuminance(color1);
    const luminance2 = calculateRelativeLuminance(color2);

    const contrastRatio = (Math.max(luminance1, luminance2) + 0.05) / (Math.min(luminance1, luminance2) + 0.05);
    return contrastRatio.toFixed(2);
}

async function increaseBGContrastToDesiredRatio(backgroundColor, textColor, desiredRatio) {
    var currentRatio = await calculateContrastRatio(backgroundColor, textColor);
    if (currentRatio >= desiredRatio) {
      return backgroundColor;
    }

    const step = 0.009;
    let adjustedColor = backgroundColor;
    while (currentRatio <= desiredRatio) {
        adjustedColor = await brightenColor(adjustedColor, step);
        currentRatio = await calculateContrastRatio(adjustedColor, textColor);
    }

    return adjustedColor;
}

async function increaseFGContrastToDesiredRatio(backgroundColor, textColor, desiredRatio) {
    var currentRatio = await calculateContrastRatio(textColor, backgroundColor);
    console.log("Current Ratio:", currentRatio)
    if (currentRatio >= desiredRatio) {
      return textColor;
    }

    const step = 0.01;
    let adjustedColor = textColor;
    while (currentRatio <= desiredRatio) {
        adjustedColor = await brightenColor(adjustedColor, step);
        currentRatio = await calculateContrastRatio(adjustedColor, backgroundColor);
    }

    return adjustedColor;
}

// Function to check if two color codes are in the same color group
async function areColorsInSameGroup(color1, color2, tolerance = 1) {
    // Convert colors to LAB format
    const labColor1 = convert.hex.lab(color1);
    const labColor2 = convert.hex.lab(color2);

    const deltaE = Math.sqrt(
    Math.pow(labColor1[0] - labColor2[0], 2) +
    Math.pow(labColor1[1] - labColor2[1], 2) +
    Math.pow(labColor1[2] - labColor2[2], 2)
    );

    const similarityThreshold = 10;

    console.log(deltaE)
    const areColorsSimilar = deltaE <= similarityThreshold;

    console.log(`Color difference (Delta E): ${deltaE}`);
    console.log(`Are the colors similar? ${areColorsSimilar}`);
}

async function hexToRgb(hex) {
    // Remove the hash character (#) if it exists
    hex = hex.replace(/^#/, '');
  
    // Parse the hex string into separate RGB values
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
  
    return { r, g, b };
  }
  
async function rgbDistance(rgb1, rgb2) {
    const dr = rgb1.r - rgb2.r;
    const dg = rgb1.g - rgb2.g;
    const db = rgb1.b - rgb2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
  
async function compareColors(hex1, hex2, threshold) {
    const rgb1 = await hexToRgb(hex1);
    const rgb2 = await hexToRgb(hex2);
    const distance = await rgbDistance(rgb1, rgb2);
    console.log("Color distance(Delta E):", distance.toFixed(2))
  
    if (distance <= threshold) {
      return true;
    } else {
      return false;
    }
}

async function main() {
    try {
        threshold = 50 // Increase/Decrease this value to match the closer color groups.
        //################download image url
        // const s3Url = 'https://wallyassets.s3.us-east-2.amazonaws.com/element_images/62c5d701-3000-45d3-a06b-851cc05e8147/0ed51077b6d47a0ccd27f1b261d92905.png';
        // fileName = await downloadImageFromS3(s3Url);
        //######################
        fileName = 'test_img2.png' // use local directory file
        //#######################
        const imageInfo = await analyzeImage(fileName);
        console.log('Original Image Text Color:', imageInfo.textInfo.textColor);
        console.log('Original Image Background Color:', imageInfo.textInfo.backgroundColor);
        
        const backgroundColor = imageInfo.textInfo.backgroundColor;
        const textColor = imageInfo.textInfo.textColor;
        const desiredRatio = 4.5;

        const finalFGAdjustedColor = await increaseFGContrastToDesiredRatio(backgroundColor, textColor, desiredRatio);
        const is_fg_suggestion = finalFGAdjustedColor == textColor ? true: false;
        if(!is_fg_suggestion){
            // const val = await areColorsInSameGroup(backgroundColor, finalFGAdjustedColor);
            console.log("-------------------------------------")
            console.log('Suggested Text Color:', finalFGAdjustedColor);
            const val = await compareColors(textColor, finalFGAdjustedColor, threshold);
            if(val){
                console.log('Suggested Text color is from same color group!');
            }
            else{
                console.log('Suggested Text color is from a different color group!');
                console.log("-------------------------------------")
                console.log("Checking the background color...")
                const finalBGAdjustedColor = await increaseBGContrastToDesiredRatio(
                    backgroundColor, textColor, desiredRatio);
                    const is_bg_suggestion = finalBGAdjustedColor == backgroundColor ? true: false;
                    if(!is_bg_suggestion){
                        // const val = await areColorsInSameGroup(backgroundColor, finalFGAdjustedColor);
                        const val = await compareColors(backgroundColor, finalBGAdjustedColor, threshold);
                        console.log('Suggested BackGround Color:', finalBGAdjustedColor);
                        if(val){
                            console.log('Suggested BackGround color is from same color group!');
                        }
                        else{
                            console.log('Suggested BackGround color is from a different color group!');
                        }
                    }
                    else{
                        console.log('No BG Suggestion Required!');
                    }
            }
        }
        else{
            console.log('No FG Suggestion Required!');
        }
    } catch (error) {
        console.error('Main Error:', error);
    }
}

main();
