#!/usr/bin/env node

var bower = require("bower");
var commander = require("commander");
var bluebird = require("bluebird");
var mkdirp = bluebird.promisifyAll(require("mkdirp")).mkdirpAsync;
var rimraf = bluebird.promisify(require("rimraf"));
var fs = bluebird.promisifyAll(require("fs"));
var _ = require("lodash");
var toposort = require("toposort");
var request = require("request");
var chalk = require("chalk");

var promisedCommand = function (stream) {
  return new bluebird.Promise(function (resolve, reject) {
    stream
      .on("end", resolve)
      .on("error", reject);
  });
};

//------------------------------------------------------------------------------

var log = {
  result: function (msg) {
    console.log(chalk.bold(msg));
  },
  debug: function (msg) {
    console.log(chalk.gray(msg));
  },
  warn: function (msg) {
    console.error(chalk.yellow(msg));
  },
  error: function (msg) {
    console.error(chalk.red(msg));
  }
};

//------------------------------------------------------------------------------

var clearCache = function () {
  return rimraf(".psc-dependencies-cache")
    .then(function () {
      log.result("Cleaned the .psc-dependencies-cache");
    });
};

//------------------------------------------------------------------------------

var createCache = function () {
  return mkdirp(".psc-dependencies-cache");
};

//------------------------------------------------------------------------------

var loadProjectsList = function () {
  return fs.readFileAsync(".psc-dependencies-cache/_index.json")
    .then(JSON.parse)
    .then(function (projects) {
      // console.log("Loaded projects list from .psc-dependencies-cache - " + projects.length + " projects");
      return projects;
    })
    .catch(function (err) {
      log.debug("Failed to load list from .psc-dependencies-cache, fetching from bower...");
      return promisedCommand(bower.commands.search("purescript"))
        .map(checkRedirect)
        .then(function (projects) {
          return fs.writeFileAsync(".psc-dependencies-cache/_index.json", JSON.stringify(projects, null, 2))
            .return(projects);
        })
        .then(function (projects) {
          log.debug("Fetched projects list - found " + projects.length + " projects");
          return projects;
        });
    });
};

//------------------------------------------------------------------------------

var checkRedirect = function (p) {
  if (!isGitHubURL(p.url)) {
    return bluebird.resolve(p);
  }
  return new bluebird.Promise(function (resolve, reject) {
    var url = reworkGitHubURL(p.url);
    log.debug("Checking if " + url + " has moved...");
    request.head(url, { followRedirect: false }, function (err, res) {
      if (err) {
        reject(err);
        return;
      }
      if (res.statusCode === 301) {
        var newURL = res.headers.location;
        var newPath = newURL.substring(newURL.indexOf("/", 8));
        log.debug(url + " has moved to " + newURL);
        p.url = "git://github.com" + newPath + ".git";
      }
      resolve(p);
    });
  });
};

//------------------------------------------------------------------------------

var loadProjectInfo = function (p) {
  var name = p.name;
  return fs.readFileAsync(".psc-dependencies-cache/" + name + ".json")
    .then(JSON.parse)
    .then(function (project) {
      // console.log("Loaded " + name + "@" + (project.latest.version || "*"));
      return project;
    })
    .catch(function (err) {
      log.debug("Fetching " + name + " info...");
      return promisedCommand(bower.commands.info(name))
        .then(function (project) {
          project.url = p.url;
          return fs.writeFileAsync(".psc-dependencies-cache/" + name + ".json", JSON.stringify(project, null, 2))
            .return(project);
        })
        .then(function (project) {
          log.debug("Fetched " + name + "@" + (project.latest.version || "*"));
          return project;
        })
        .catch(function (err) {
          if (err.details && err.details.indexOf("Repository not found") != -1) {
            log.warn("Failed to fetch " + name + " info: " + err.data.resolver.source + " does not exist");
            return null;
          } else {
            throw err;
          }
        });
    });
};

//------------------------------------------------------------------------------

var loadProjects = function () {
  return createCache()
    .then(loadProjectsList)
    .map(loadProjectInfo, { concurrency: 8 })
    .then(function (projects) {
      var actualProjects = projects
        .filter(function (p) { return p !== null; });
      var aplist = actualProjects.map(function (p) {
        return { name: p.name, url: p.url };
      });
      return fs.writeFileAsync(".psc-dependencies-cache/_index.json", JSON.stringify(aplist, null, 2))
        .return(actualProjects);
    });
};

//------------------------------------------------------------------------------

var findAllDependencies = function (initial, edges) {
  var pending = [initial];
  var done = [];
  var result = [];
  while (pending.length > 0) {
    var item = pending.pop();
    done.push(item);
    edges.forEach(function(edge) {
      if (edge[0] === item) {
        if (result.indexOf(edge[1]) === -1) {
          result.push(edge[1]);
          pending.push(edge[1]);
        }
      }
    });
  }
  return result;
};

//------------------------------------------------------------------------------

var makeGraph = function (projects) {
  var nodes = projects.map(function (p) { return p.name; });
  var edges = _.flatten(projects.map(function (p) {
    var dependencies = Object.keys(p.latest.dependencies || {});
    return dependencies
      .filter(function (d) { return nodes.indexOf(d) !== -1; })
      .map(function (d) { return [d, p.name]; });
  }));
  return { edges: edges, nodes: nodes };
};

//------------------------------------------------------------------------------

var findEntry = function (projects, name) {
  return _.find(projects, function (p) {
    return p.name === name;
  });
};

//------------------------------------------------------------------------------

var isGitHubURL = function (url) {
  return url.indexOf("git://github.com") === 0;
};

var reworkGitHubURL = function (url) {
  if (isGitHubURL(url)) {
    return "https://github.com" + url.substring(16, url.length - 4);
  }
  return url;
};

//------------------------------------------------------------------------------

var isFiltered = function (owners, project) {
  if (!_.isArray(owners)) return false;
  var url = project.url;
  if (!isGitHubURL(url)) return true;
  return owners.indexOf(url.substring(17, url.indexOf("/", 17))) === -1;
};

//------------------------------------------------------------------------------

var list = function (val) {
  return val.split(',');
};

commander
  .version(require("./package.json").version)
  .option("--clean", "Clean the .psc-dependencies-cache")
  .option("--lookup [name]", "Lookup all the dependants of the specified module")
  .option("--markdown", "Generate the lookup result as a markdown list")
  .option("--direct", "Don't include transitive dependants in the output")
  .option("--filter-owners <owners>", "Filter the result to only include projects with these owners (comma-separated list)", list)
  .parse(process.argv);

//------------------------------------------------------------------------------

if (commander.clean) {
  clearCache();
} else {
  loadProjects()
    .then(function (projects) {
      console.log("");

      var graph = makeGraph(projects);

      if (commander.lookup) {
        if (!_.isString(commander.lookup)) {
          log.error("Please enter a name to lookup");
          return;
        }
        var lookup = commander.lookup;
        log.result("Dependants of " + lookup + ":\n");

        var ledges = findAllDependencies(lookup, graph.edges);
        ledges.unshift(lookup);
        ledges.sort();

        var xs = _.flatten(ledges.map(function (dep) {
          var related = _.unique(graph.edges
            .filter(function (edge) { return edge[1] === dep; })
            .map(function (edge) { return edge[0]; })
            .filter(function (related) {
              return related === dep || ledges.indexOf(related) != -1;
            }));
          return related.map(function (rel) { return [rel, dep]; });
        }));

        var sorted = toposort(xs);
        if (sorted[0] == lookup) sorted.shift();

        sorted.forEach(function (name) {
          var p = findEntry(projects, name);
          var dependencies = Object.keys(p.latest.dependencies || {});
          var isTransitive = dependencies.indexOf(lookup) === -1;
          if (!isFiltered(commander.filterOwners, p) && (!commander.direct || !isTransitive)) {
            if (commander.markdown) {
              console.log("- [ ] [" + name + "](" + reworkGitHubURL(p.url) + ")" + (isTransitive ? "*" : ""));
            } else {
              console.log(name + (isTransitive ? "*" : "") + " - " + chalk.cyan(reworkGitHubURL(p.url)));
            }
          }
        });
      }
    });
}
