const fs = require("fs/promises");
const syncfs = require("fs");
const sharp = require("sharp");

const config = {
    OUTPUT_WIDTH: 64,
    OUTPUT_HEIGHT: 64,
    INPUT_PATH: "./input/rp/assets/minecraft/optifine/cit",
    OUTPUT_PATH: "./output",
}

const output = {
    ITEM_FOLDER: `${config.OUTPUT_PATH}/item`,
    CHARM_FOLDER: `${config.OUTPUT_PATH}/charm`
}

// This array keeps track of which images have been resized already. This is useful for dyable armor, because:
// - if a file that ends in "_overlay" is encountered, that should be colored brown and layered ontop of the file
//   without the "_overlay" ending, but equal rest of the name, and save it with that name.
// - if this happens after the other item (without "_overlay") has been already processed, this will overwrite the
//   previously generated output, which is fine.
// - if this happens before, then processing the item without "_overlay" would overwrite the correct output with an
//   incorrect one. To fix this, the array below will help pose the condition of avoiding to convert files with
//   names present in the array, added to it when "_overlay" is found in the file name.
const resizedImageNames = [];

/**
 * Extract the extension of a given file.
 * @param {String} fileName 
 * @returns {String} The extension of the file name provided.
 */
function getExtension(fileName) {
    let extensionParts = fileName.split(".");
    return extensionParts[extensionParts.length - 1];
}

/**
 * Resizes an image down to a square, whose side is the max between
 * width and height. This is to account for animated sprites, which
 * are extra long images with every frame stacked ontop of eachother
 * (only the first frame will be extracted).
 * @param {String} fileName the name of the image to resize. 
 * @param {String} filePath the path of the image to resize.
 * @param {String} lastDirectoryName the name of the parent directory of the image to resize.
 * @returns {void}
 */
async function resizeImage(fileName, filePath, lastDirectoryName) {
    // A bunch of files that I currently don't care about.
    // There are a few inconsistencies with naming that increase the amount of these checks.
    let fileNameNoExtension = fileName.replace(".png", "");

    if (fileNameNoExtension.endsWith("_e") || fileNameNoExtension.endsWith("_blocking") || fileNameNoExtension.includes("_pulling_")
        || fileNameNoExtension.includes("_loading_") || fileNameNoExtension.endsWith("_loaded") || fileNameNoExtension.endsWith("_arrow")
        || fileNameNoExtension.includes("_armor") || fileNameNoExtension.endsWith("_cooldown")) {

        return;
    }

    let isOverlay = false;
    if (fileNameNoExtension.endsWith("_overlay")) {
        // Check if a non overlay texture exists. If it doesn't, simply return.
        if (!syncfs.existsSync(`${filePath}/${fileName.replace("_overlay", "")}`) || getExtension(fileName.replace("_overlay", "")) != "png") {
            return;
        }

        resizedImageNames.push(fileNameNoExtension.replace("_overlay", ""));
        isOverlay = true;
    } else if (resizedImageNames.includes(fileNameNoExtension)) {
        return;
    }

    // R3 Casino Potions' files are just called "potion", with the parent folder containing the actual name.
    let finalFileName = (fileNameNoExtension == "potion") ? lastDirectoryName : fileNameNoExtension;
    finalFileName = finalFileName.replace("_standby", "").replace("_icon", "").replace("_full", "");

    // Output Path Manipulation
    let outputPath = isCharm(filePath) ? output.CHARM_FOLDER : output.ITEM_FOLDER;
    if (isOverlay) {
        // The output should not be considered to have _overlay in the name.
        finalFileName = finalFileName.replace("_overlay", "");
    }
    outputPath += `/${upperCamelCase(finalFileName)}.png`;

    if (!isOverlay) {
        let image = sharp(`${filePath}/${fileName}`);
        await image.metadata()
            .then((metadata) => {
                return image
                    // width and height will need to both be width in order to catch the first frame of an eventual animated texture
                    .extract({ left: 0, top: 0, width: metadata.width, height: (metadata.height > metadata.width) ? metadata.width : metadata.height })
                    .resize(config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT, {kernel: sharp.kernel.nearest})
                    .toFile(outputPath);
            })
            .catch((e) => {
                console.log("Error on file", fileName, "With path", filePath, "In dir", lastDirectoryName);
                console.error(e);
            });
        return;
    }
    
    // Start with opening the dyeable part.
    let dyeablePart = sharp(`${filePath}/${fileName.replace("_overlay", "")}`);
    await dyeablePart.metadata()
        .then(async (metadata) => {
            const dyeablePartBuffer = await dyeablePart
                // width and height will need to both be width in order to catch the first frame of an eventual animated texture
                .extract({ left: 0, top: 0, width: metadata.width, height: (metadata.height > metadata.width) ? metadata.width : metadata.height })
                .resize(config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT, { kernel: sharp.kernel.nearest })
                .toBuffer();
            // Create brown color square and cut it with "dest-in" blend mode, with the shape of the item.
            const cutDyeSquareBuffer = await sharp({
                create: {
                    width: config.OUTPUT_WIDTH,
                    height: config.OUTPUT_HEIGHT,
                    channels: 4,
                    background: { r: 160, g: 101, b: 64, alpha: 255 }
                }
            })
                .composite([{ input: dyeablePartBuffer, left: 0, top: 0, blend: "dest-in" }])
                .png()
                .toBuffer();
            // Compose the cut brown square ontop of the dyeable part, with "multiply" blend mode.
            const dyedPartBuffer = await sharp(dyeablePartBuffer)
                .composite([{ input: cutDyeSquareBuffer, left: 0, top: 0, blend: "multiply" }])
                .toBuffer();
            // Prepare the static part, as it needs to be put on top of the dyeable part.
            // (not the other way around, this is how minecraft does it)
            const staticPartBuffer = await sharp(`${filePath}/${fileName}`)
                .extract({left: 0, top: 0, width: metadata.width, height: (metadata.height > metadata.width) ? metadata.width : metadata.height})
                .resize(config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT, {kernel: sharp.kernel.nearest})
                .toBuffer();
            // Compose the dyed dyeable part and the static part together.
            await sharp(dyedPartBuffer)
                .composite([{ input: staticPartBuffer, left: 0, top: 0 }])
                .toFile(outputPath);
        })
        .catch((e) => {
            console.log("Error on dyeing file", fileName, "With path", filePath, "In dir", lastDirectoryName);
            console.error(e);
        });
}

/**
 * Returns a string in upperCamelCase format, with some extra additions
 * for OhTheMisery compliance.
 * @param {String} string 
 * @returns {String} A string in upperCamelCase format.
 */
function upperCamelCase(string) {
    let blacklist = ["of", "the"];
    let step = string.split("_").map((piece, index) => `${(blacklist.includes(piece) && index != 0) ? piece[0] : piece[0].toUpperCase()}${piece.substring(1)}`).join("_");
    return step;
}

/**
 * Returns true if the file is within some subdirectory of the "/charm" directory.
 * @param {String} filePath the path of the file being examined.
 * @returns {boolean}
 */
function isCharm(filePath) {
    // Make sure to exclude the file name, so match "/charm/" since there are no stray files in that directory.
    return filePath.includes("/charm/");
}

/**
 * Checks if the extension of the file is .png and act accordingly, so either do nothing (discard)
 * or resize the image and send it to the output.
 * @param {String} fileName the name of the file being examined.
 * @param {String} filePath the path of the file being examined.
 * @param {String} lastDirectoryName the name of the parent folder of the file being examined.
 * @returns {Promise<boolean>}
 */
async function visitFile(fileName, filePath, lastDirectoryName) {
    return new Promise(async function(resolve) {

        if (getExtension(fileName) == "png") {
            resizeImage(fileName, filePath, lastDirectoryName);
        }

        resolve(true);
    });
}

/**
 * Recursive function to visit every single directory entry within a starting directory root.
 * @param {String} currentPath the current path being visited.
 * @param {String} lastDirectoryName the name of the parent directory.
 * @returns {Promise<boolean>}
 */
async function visitRecursive(currentPath, lastDirectoryName) {
    return new Promise(async function(resolve) {

        let dir = await fs.opendir(currentPath);
        for await (const dirEnt of dir) {
            if (dirEnt.isFile()) {
                await visitFile(dirEnt.name, currentPath, lastDirectoryName);
            } else {
                await visitRecursive(`${currentPath}/${dirEnt.name}`, dirEnt.name);
            }
        }

        resolve(true);
    });
}

async function main() {
    // Clean the output folder
    await fs.rm(config.OUTPUT_PATH, {recursive: true});
    await fs.mkdir(config.OUTPUT_PATH);
    await fs.mkdir(output.ITEM_FOLDER);
    await fs.mkdir(output.CHARM_FOLDER);

    await visitRecursive(config.INPUT_PATH, "cit");
    console.log("done!");
}

main();