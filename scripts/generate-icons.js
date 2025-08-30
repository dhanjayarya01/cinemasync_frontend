const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Icon sizes for PWA
const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  const svgPath = path.join(__dirname, '../public/icons/icon.svg');
  const outputDir = path.join(__dirname, '../public/icons');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating PWA icons...');

  for (const size of iconSizes) {
    const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
    
    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${size}x${size} icon`);
    } catch (error) {
      console.error(`✗ Failed to generate ${size}x${size} icon:`, error.message);
    }
  }

  console.log('Icon generation complete!');
}

// Generate splash screens for iOS
async function generateSplashScreens() {
  const svgPath = path.join(__dirname, '../public/icons/icon.svg');
  const outputDir = path.join(__dirname, '../public/splash');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // iOS splash screen sizes
  const splashScreens = [
    { name: 'apple-splash-2048-2732', width: 2048, height: 2732 },
    { name: 'apple-splash-1668-2388', width: 1668, height: 2388 },
    { name: 'apple-splash-1536-2048', width: 1536, height: 2048 },
    { name: 'apple-splash-1125-2436', width: 1125, height: 2436 },
    { name: 'apple-splash-1242-2688', width: 1242, height: 2688 },
    { name: 'apple-splash-750-1334', width: 750, height: 1334 },
    { name: 'apple-splash-640-1136', width: 640, height: 1136 },
  ];

  console.log('Generating splash screens...');

  for (const screen of splashScreens) {
    const outputPath = path.join(outputDir, `${screen.name}.png`);
    
    try {
      // Create a background with the app icon centered
      const background = sharp({
        create: {
          width: screen.width,
          height: screen.height,
          channels: 4,
          background: { r: 124, g: 58, b: 237, alpha: 1 } // Purple background
        }
      });

      // Resize the icon for the splash screen
      const iconSize = Math.floor(Math.min(screen.width, screen.height) * 0.3);
      const icon = await sharp(svgPath)
        .resize(iconSize, iconSize)
        .png()
        .toBuffer();

      // Composite the icon onto the background
      await background
        .composite([{
          input: icon,
          gravity: 'center'
        }])
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${screen.name} splash screen`);
    } catch (error) {
      console.error(`✗ Failed to generate ${screen.name} splash screen:`, error.message);
    }
  }

  console.log('Splash screen generation complete!');
}

// Run the generation
async function main() {
  try {
    await generateIcons();
    await generateSplashScreens();
    console.log('All PWA assets generated successfully!');
  } catch (error) {
    console.error('Error generating PWA assets:', error);
    process.exit(1);
  }
}

main();
