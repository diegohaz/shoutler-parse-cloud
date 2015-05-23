var Feeling = require('cloud/Feeling');

var Shout = Parse.Object.extend('Shout', {

  filter: function() {
    var shout = this;
    var user = shout.get('user');

    if (!user) {
      return Parse.Promise.error('Empty user');
    }

    return user.fetch().then(function() {
      // Defaults
      shout.get('location') || shout.set('location', user.get('location'));
      shout.get('place')    || shout.set('place', user.get('place'));
      shout.get('feeling')  || shout.set('feeling', user.get('feeling'));
      shout.get('echoes')   || shout.set('echoes', 0);
      shout.get('flags')    || shout.set('flags', 0);

      // Empty validations
      if (!shout.get('location')) return Parse.Promise.error('Empty location');
      if (!shout.get('place'))    return Parse.Promise.error('Empty place');
      if (!shout.get('feeling'))  return Parse.Promise.error('Empty feeling');
      if (!shout.get('content'))  return Parse.Promise.error('Empty content');

      // More validations
      if (!Feeling.validate(shout.get('feeling'))) {
        return Parse.Promise.error('Invalid feeling');
      } else if (shout.get('content').length > 255) {
        return Parse.Promise.error('Content should not be larger than 255 characters');
      }

      // ACL
      if (shout.isNew()) {
        var acl = new Parse.ACL(user);

        acl.setPublicReadAccess(true);
        shout.setACL(acl);
      }

      return Parse.Promise.as();
    });
  },

  wipe: function() {
    Parse.Cloud.useMasterKey();
    var shout = this;

    // Seek users which have references to shout
    var wasEchoed = new Parse.Query('UserInfo');
    wasEchoed.equalTo('echoes', shout);

    var wasDeleted = new Parse.Query('UserInfo');
    wasDeleted.equalTo('deletes', shout);

    // Finally, query
    var query = Parse.Query.or(wasEchoed, wasDeleted);

    return query.find().then(function(infos) {
      var infosToSave = [];

      for (var i = 0; i < infos.length; i++) {
        var info = infos[i];

        info.remove('echoes', shout);
        info.remove('deletes', shout);

        infosToSave.push(info);
      }

      if (infosToSave.length) {
        return Parse.Object.saveAll(infosToSave);
      } else {
        return Parse.Promise.as();
      }
    });
  },

  echo: function() {
    this.increment('echoes');

    return this.save(null, {useMasterKey: true});
  },

  unecho: function() {
    this.increment('echoes', -1);

    return this.save(null, {useMasterKey: true});
  },

  flag: function(description) {
    var shout = this;
    var flag = new Parse.Object('Flag');

    flag.set('shout', shout);
    flag.set('description', description);

    return flag.save().then(function(flag) {
      shout.increment('flags');
      shout.save();

      return Parse.Promise.as(flag);
    });
  }

}, {

  list: function(location, limit, page) {
    // Params
    limit = limit || 20;
    page  = page  || 0;

    if (!location) return Parse.Promise.error('Empty location');

    // Query
    var shouts = new Parse.Query(Shout);
    var now    = Date.now();

    shouts.near('location', location);
    shouts.withinKilometers('location', location, 20000);

    // Include 4 levels of places depth
    shouts.include([
      'place', 'place.parent', 'place.parent.parent', 'place.parent.parent.parent',
      'place.parent.parent.parent.parent', 'place.parent.parent.parent.parent.parent',
      'place.parent.parent.parent.parent.parent.parent',
    ]);
    shouts.limit(limit);
    shouts.skip(limit * page);

    return shouts.find().then(function(shouts) {
      var ranks = [];

      for (var i = 0; i < shouts.length; i++) {
        var shout   = shouts[i];
        var place   = shout.get('place');
        var radius  = place.get('radius');
        var depth   = place.get('depth');
        var parent  = place.get('parent');

        // Rank
        var echoes  = shout.get('echoes') || 0;
        var minutes = (now - shout.createdAt.getTime()) / 60000;
        var meters  = location.kilometersTo(shout.get('location')) * 1000;

        // 1 meter = 3 seconds = 10 echoes
        ranks[i] = meters + minutes/20 - echoes/10;

        // Place radius
        while (parent && meters > parent.get('radius')) {
          shout.attributes.place = parent;
          parent = parent.get('parent');
        }

        // Don't return unnecessary places
        shout.attributes.place.attributes.parent = null
      }

      if (shouts.length) {
        var shouts = _.sortBy(shouts, function(shout, index) {
          return ranks[index];
        });
      }

      return Parse.Promise.as(shouts);
    });
  }

});

module.exports = Shout;