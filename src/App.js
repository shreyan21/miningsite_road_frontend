import React, { useState, useEffect, useRef } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { Style, Stroke, Fill, Circle, Text } from 'ol/style';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:5000/api';

// Styles
const styles = {
  highway: new Style({
    stroke: new Stroke({
      color: '#2563eb',
      width: 3
    })
  }),
  newRoad: new Style({
    stroke: new Stroke({
      color: '#dc2626',
      width: 3,
      lineDash: [10, 5]
    })
  }),
  miningSite: new Style({
    image: new Circle({
      radius: 8,
      fill: new Fill({ color: '#7c3aed' }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }),
  miningSiteConnected: new Style({
    image: new Circle({
      radius: 8,
      fill: new Fill({ color: '#16a34a' }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }),
  school: new Style({
    image: new Circle({
      radius: 6,
      fill: new Fill({ color: '#ea580c' }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }),
  schoolBuffer: new Style({
    stroke: new Stroke({
      color: '#ea580c',
      width: 2,
      lineDash: [5, 5]
    }),
    fill: new Fill({
      color: 'rgba(234, 88, 12, 0.1)'
    })
  }),
  river: new Style({
    stroke: new Stroke({
      color: '#0891b2',
      width: 2
    }),
    fill: new Fill({
      color: 'rgba(8, 145, 178, 0.3)'
    })
  }),
  proposedRoute: new Style({
    stroke: new Stroke({
      color: '#db2777',
      width: 4,
      lineDash: [8, 4]
    })
  })
};

function App() {
  const mapRef = useRef();
  const mapInstance = useRef();
  const [schoolBuffer, setSchoolBuffer] = useState(500);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({});
  const [selectedMining, setSelectedMining] = useState(null);
  const [proposedRoute, setProposedRoute] = useState(null);
  const [message, setMessage] = useState('');

  // Layer refs
  const layers = useRef({});

  useEffect(() => {
    // Initialize map
    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM()
        })
      ],
      view: new View({
        center: fromLonLat([83.3732, 26.7606]), // Gorakhpur
        zoom: 12
      })
    });

    mapInstance.current = map;

    // Initialize vector layers
    const layerConfigs = [
      { name: 'highways', style: styles.highway },
      { name: 'rivers', style: styles.river },
      { name: 'schools', style: styles.school },
      { name: 'schoolBuffers', style: styles.schoolBuffer },
      { name: 'miningSites', style: styles.miningSite },
      { name: 'newRoads', style: styles.newRoad },
      { name: 'proposedRoute', style: styles.proposedRoute }
    ];

    layerConfigs.forEach(config => {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source: source,
        style: config.style,
        visible: config.name !== 'schoolBuffers'
      });
      map.addLayer(layer);
      layers.current[config.name] = { layer, source };
    });

    // Load initial data
    loadAllData();

    return () => map.setTarget(undefined);
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadHighways(),
        loadRivers(),
        loadSchools(),
        loadMiningSites(),
        loadRoads(),
        loadStatistics()
      ]);
      setMessage('Data loaded successfully');
    } catch (err) {
      setMessage('Error loading data: ' + err.message);
    }
    setLoading(false);
  };

  const loadHighways = async () => {
    const res = await axios.get(`${API_URL}/highways`);
    const features = new GeoJSON().readFeatures(res.data, {
      featureProjection: 'EPSG:3857'
    });
    layers.current.highways.source.clear();
    layers.current.highways.source.addFeatures(features);
  };

  const loadRivers = async () => {
    const res = await axios.get(`${API_URL}/rivers`);
    const features = new GeoJSON().readFeatures(res.data, {
      featureProjection: 'EPSG:3857'
    });
    layers.current.rivers.source.clear();
    layers.current.rivers.source.addFeatures(features);
  };

  const loadSchools = async () => {
    const res = await axios.get(`${API_URL}/schools`);
    const features = new GeoJSON().readFeatures(res.data, {
      featureProjection: 'EPSG:3857'
    });
    layers.current.schools.source.clear();
    layers.current.schools.source.addFeatures(features);
  };

  const loadMiningSites = async () => {
    const res = await axios.get(`${API_URL}/mining-sites`);
    const features = new GeoJSON().readFeatures(res.data, {
      featureProjection: 'EPSG:3857'
    });
    layers.current.miningSites.source.clear();
    layers.current.miningSites.source.addFeatures(features);
  };

  const loadRoads = async () => {
    const res = await axios.get(`${API_URL}/roads`);
    const features = new GeoJSON().readFeatures(res.data, {
      featureProjection: 'EPSG:3857'
    });
    
    // Separate highways and new roads
    const highways = features.filter(f => f.get('road_type') === 'highway');
    const newRoads = features.filter(f => f.get('road_type') === 'mining_access');
    
    layers.current.highways.source.clear();
    layers.current.highways.source.addFeatures(highways);
    layers.current.newRoads.source.clear();
    layers.current.newRoads.source.addFeatures(newRoads);
  };

  const loadStatistics = async () => {
    const res = await axios.get(`${API_URL}/statistics`);
    setStats(res.data);
  };

  const handleShowBuffers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/obstacles?schoolBuffer=${schoolBuffer}`);
      const features = new GeoJSON().readFeatures(res.data, {
        featureProjection: 'EPSG:3857'
      });
      
      // Filter only school buffers
      const buffers = features.filter(f => f.get('type') === 'school_buffer');
      layers.current.schoolBuffers.source.clear();
      layers.current.schoolBuffers.source.addFeatures(buffers);
      layers.current.schoolBuffers.layer.setVisible(true);
      
      setMessage(`Showing school buffers with ${schoolBuffer}m radius`);
    } catch (err) {
      setMessage('Error loading obstacles: ' + err.message);
    }
    setLoading(false);
  };

  const calculateRoute = async (miningGid) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/calculate-route`, {
        miningGid,
        schoolBuffer
      });
      
      const route = res.data;
      setProposedRoute(route);
      
      // Display on map
      const feature = new GeoJSON().readFeature(route.geometry, {
        featureProjection: 'EPSG:3857'
      });
      feature.setProperties({
        length: route.pathLength,
        cost: route.pathCost
      });
      
      layers.current.proposedRoute.source.clear();
      layers.current.proposedRoute.source.addFeature(feature);
      
      // Zoom to route
      mapInstance.current.getView().fit(feature.getGeometry(), {
        padding: [100, 100, 100, 100]
      });
      
      setMessage(`Route calculated: ${(route.pathLength / 1000).toFixed(2)} km`);
    } catch (err) {
      setMessage('Error calculating route: ' + err.message);
    }
    setLoading(false);
  };

  const generateAllRoads = async () => {
    if (!window.confirm(`Generate roads for all mining sites with ${schoolBuffer}m school buffer?`)) {
      return;
    }
    
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/generate-all-roads`, {
        schoolBuffer,
        batchSize: 50
      });
      
      const { processedCount, totalRoadLength, failedSites } = res.data;
      
      await loadRoads();
      await loadStatistics();
      await loadMiningSites(); // Refresh to show connected status
      
      setMessage(
        `Generated ${processedCount} roads. ` +
        `Total length: ${(totalRoadLength / 1000).toFixed(2)} km. ` +
        `Failed: ${failedSites.length}`
      );
    } catch (err) {
      setMessage('Error generating roads: ' + err.message);
    }
    setLoading(false);
  };

  const resetNetwork = async () => {
    if (!window.confirm('Reset all roads to highways only?')) return;
    
    setLoading(true);
    try {
      await axios.post(`${API_URL}/reset-network`);
      await loadRoads();
      await loadStatistics();
      await loadMiningSites();
      layers.current.proposedRoute.source.clear();
      setMessage('Network reset to highways only');
    } catch (err) {
      setMessage('Error resetting network: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="app">
      <div className="sidebar">
        <h1>Mining Road Router</h1>
        
        <div className="section">
          <h3>Configuration</h3>
          <label>
            School Buffer (meters):
            <input
              type="number"
              value={schoolBuffer}
              onChange={(e) => setSchoolBuffer(Number(e.target.value))}
              min="0"
              max="5000"
            />
          </label>
          <button onClick={handleShowBuffers}>Show Obstacles</button>
        </div>

        <div className="section">
          <h3>Actions</h3>
          <button onClick={generateAllRoads} disabled={loading}>
            Generate All Roads
          </button>
          <button onClick={resetNetwork} disabled={loading} className="danger">
            Reset Network
          </button>
        </div>

        <div className="section">
          <h3>Statistics</h3>
          <div className="stats">
            <div>Total Mining Sites: {stats.total_mining_sites}</div>
            <div>Connected: {stats.connected_sites}</div>
            <div>New Roads: {stats.new_roads_count}</div>
            <div>New Road Length: {stats.new_roads_length ? 
              Number(stats.new_roads_length).toFixed(2) : 0} km</div>
          </div>
        </div>

        {proposedRoute && (
          <div className="section route-info">
            <h3>Proposed Route</h3>
            <div>Length: {(proposedRoute.pathLength / 1000).toFixed(2)} km</div>
            <div>Cost: {proposedRoute.pathCost.toFixed(0)}</div>
            <div>Connected to: {proposedRoute.connectedToExisting ? 'Highway' : 'Existing Road'}</div>
          </div>
        )}

        {message && (
          <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </div>

      <div className="map-container">
        <div ref={mapRef} className="map" />
        
        <div className="legend">
          <div className="legend-item">
            <span className="color-box" style={{background: '#2563eb'}}></span>
            Highway
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#dc2626'}}></span>
            New Road
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#7c3aed'}}></span>
            Mining Site
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#16a34a'}}></span>
            Connected Site
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#ea580c'}}></span>
            School
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#0891b2'}}></span>
            River
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#db2777'}}></span>
            Proposed Route
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;