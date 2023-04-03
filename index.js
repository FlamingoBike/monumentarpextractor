const fs = require("fs/promises");
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
function resizeImage(fileName, filePath, lastDirectoryName) {
    // A bunch of files that I currently don't care about.
    // There are a few inconsistencies with naming that increase the amount of these checks.
    let fileNameNoExtension = fileName.replace(".png", "");

    if (fileNameNoExtension.endsWith("_e") || fileNameNoExtension.endsWith("_blocking") || fileNameNoExtension.includes("_pulling_")
        || fileNameNoExtension.includes("_loading_") || fileNameNoExtension.endsWith("_loaded") || fileNameNoExtension.endsWith("_arrow")
        || fileNameNoExtension.endsWith("_armor") || fileNameNoExtension.endsWith("_cooldown") || fileNameNoExtension.endsWith("_overlay")) {

        return;
    }

    // R3 Casino Potions' files are just called "potion", with the parent folder containing the actual name.
    let finalFileName = (fileNameNoExtension == "potion") ? lastDirectoryName : fileNameNoExtension;
    finalFileName = finalFileName.replace("_standby", "").replace("_icon", "");

    // Output Path Manipulation
    let outputPath = isCharm(filePath) ? output.CHARM_FOLDER : output.ITEM_FOLDER;
    outputPath += `/${upperCamelCase(finalFileName)}.png`;

    let image = sharp(`${filePath}/${fileName}`);
    image.metadata()
        .then((metadata) => {
            return image
                // width and height will need to both be width in order to catch the first frame of an eventual animated texture
                .extract({left: 0, top: 0, width: metadata.width, height: (metadata.height > metadata.width) ? metadata.width : metadata.height})
                .resize(config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT, {kernel: sharp.kernel.nearest})
                .toFile(outputPath);
        })
        .catch((e) => {
            console.log("Error on file", fileName, "With path", filePath, "In dir", lastDirectoryName);
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