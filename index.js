const Eris = require("eris");
const request = require("request");
const ColorThief = require("color-thief");

// Load config file
const CONFIG_PATH = "./config";

var CONFIG;

try {
    CONFIG = require(CONFIG_PATH);
} catch (err) {
    console.error("Failed to load config file:", err.name, ":", err.message);
    console.error("Edit config.example.json, then save as", CONFIG_PATH);
    process.exit(1);
}

// FIXME: Exporting the bot reference for interactive debugging
const bot = module.exports = new Eris(CONFIG.token);
const colorThief = bot.colorThief = new ColorThief();

// Dump error messages to stderr
bot.on("error", console.error.bind(console, "Error: "));

// Set status (if given in CONFIG)
bot.on("ready", () => {
    // FIXME: Is fetchAllMembers ever needed?
    console.log("ColorBot started");
    if (!!CONFIG.game) {
        bot.editStatus(CONFIG.game);
    }
});

// TODO: Implement some commands to allow users to manage their role colors

bot.on("userUpdate", (user, oldUser) => {
    // TODO: Refactor into some more readable functions

    // Ignore if avatar unchanged
    if (!!oldUser && user.avatar === oldUser.avatar) {
        return;
    }

    // Get a list of this user's Member objects for each guild we care about
    const members = CONFIG.guilds
        .map(guildID => bot.guilds.get(guildID).members.get(user.id))
        .filter(member => !!member);

    // Ignore if user is not in any guilds we care about
    if (members.length === 0) {
        return;
    }

    const tag = `${user.username}#${user.discriminator}`;
    const url = user.staticAvatarURL;
    console.log("Processing avatar:", tag, url);

    // Build a list of promised roles that will need the new color assigned
    const roles = members
        .map(member => {
            const guild = member.guild;

            // Check whether this member already has a color role
            const existing = member.roles
                .map(roleID => guild.roles.get(roleID))
                .find(role => role.name.startsWith("#"));

            if (!!existing) {
                return Promise.resolve(existing);
            }

            // Get the position of our own highest role
            const rolePos = guild.members.get(bot.user.id).roles
                .map(roleID => guild.roles.get(roleID).position)
                .reduce((a,b) => Math.max(a,b), 0);

            // Create a new role if one does not already exist
            // Set the new role's position as high as possible
            const created = guild.createRole()
                .then(role => role.edit({name: "#??????", permissions: 0}))
                .catch(err => {
                    const errMsg = `${err.name}: ${err.message}`;
                    throw new Error(`Failed to create role for ${tag} in ${guild.name}: ${errMsg}`);
                })
                .then(role => {
                    return member.addRole(role.id).then(() => role)
                        .catch(err => {
                            const errMsg = `${err.name}: ${err.message}`;
                            // If this fails, a new role will be created on the next attempt
                            // Delete this one so that it is not "leaked"
                            return role.delete()
                                .then(() => {
                                    throw new Error(`Failed to add role to ${tag} in ${guild.name}: ${errMsg}`);
                                });
                        });
                })
                .then(role => {
                    return role.editPosition(rolePos - 1).then(() => role)
                        .catch(err => {
                            const errMsg = `${err.name}: ${err.message}`;
                            throw new Error(`Failed to set role position for ${tag} in ${guild.name}: ${errMsg}`);
                        });
                });

            return created;
        });

    request({url: url, encoding: null}, (err, msg, body) => {
        const palette = colorThief.getPalette(body, 20, 2)
            .map(c => ({
                color: c,
                brightness: (c[0]*0.299 + c[1]*0.587 + c[2]*0.114) / 255,
                saturation: 1 - Math.min(c[0], c[1], c[2]) / Math.max(c[0], c[1], c[2]),
            }));

        const validColors = palette
            .filter(c => c.brightness > 0.35 && c.saturation > 0.20)
            .map((c,i) => [c.color, (i+5)/(c.brightness*c.saturation)])
            .sort((a,b) => a[1] - b[1]);

        if (validColors.length === 0) {
            console.log("No colors available for", tag);
            return;
        }

        // Convert chosen color to numeric form
        // TODO: Allow colors other than the first to be chosen
        const color = validColors[0][0]
            .reduce((a,b) => (a<<8) + b);

        // Get color string to use as role name
        const colorName = "#"+color.toString(16);

        console.log("Color:", tag, colorName);

        // Update roles with the new color values
        roles.forEach(rolePromise => {
            rolePromise
                .then(role => {
                    const guild = role.guild;
                    return role.edit({name: colorName, color: color})
                        .catch(err => {
                            const errMsg = `${err.name}: ${err.message}`;
                            throw new Error(`Failed to update color for ${tag} in ${guild.name}: ${errMsg}`);
                        });
                })
                .catch(console.error.bind(console));
        });
    });
});

bot.connect();
